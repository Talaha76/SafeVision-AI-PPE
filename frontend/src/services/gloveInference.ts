import {
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";

import type { PPEDetection } from "./ppeDetector";

type Box = [number, number, number, number];

type Landmark = {
  x: number;
  y: number;
};

export type GloveInferenceMode = "image" | "video";

const MEDIAPIPE_VERSION = "1.1.1";
const MEDIAPIPE_WASM_ROOT =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const MAX_HANDS = 6;
const MIN_HAND_DETECTION_CONFIDENCE = 0.60;
const MIN_HAND_PRESENCE_CONFIDENCE = 0.60;
const MIN_TRACKING_CONFIDENCE = 0.60;

/*
 * NO-Gloves is NOT a trained YOLO class in this project.
 *
 * We only emit a synthetic no_gloves detection when all of these are true:
 * 1. MediaPipe finds a clearly visible hand.
 * 2. The hand belongs to a detected Person.
 * 3. The existing PPE model does not detect Gloves near that hand.
 * 4. The hand crop contains enough skin-like pixels to look exposed.
 *
 * Step 4 is deliberately used as a false-positive suppressor. It prevents a
 * visible glove from being treated as a bare hand merely because YOLO missed
 * the positive Gloves class.
 */
const HAND_BOX_PADDING = 0.12;
const GLOVE_SEARCH_PADDING = 0.65;
const MIN_GLOVE_HAND_OVERLAP = 0.05;
const MIN_HAND_SIZE_RATIO = 0.015;

const HAND_ANALYSIS_SIZE = 72;
const MIN_SKIN_PIXEL_RATIO = 0.24;
const STRONG_SKIN_PIXEL_RATIO = 0.50;

const MIN_INFERENCE_SCORE = 0.55;
const MAX_INFERENCE_SCORE = 0.70;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function boxArea(box: Box): number {
  return (
    Math.max(0, box[2] - box[0])
    * Math.max(0, box[3] - box[1])
  );
}

function intersectionArea(a: Box, b: Box): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);

  return (
    Math.max(0, x2 - x1)
    * Math.max(0, y2 - y1)
  );
}

function expandBox(
  box: Box,
  paddingRatio: number,
  frameWidth: number,
  frameHeight: number,
): Box {
  const width = box[2] - box[0];
  const height = box[3] - box[1];
  const padX = width * paddingRatio;
  const padY = height * paddingRatio;

  return [
    clamp(box[0] - padX, 0, frameWidth),
    clamp(box[1] - padY, 0, frameHeight),
    clamp(box[2] + padX, 0, frameWidth),
    clamp(box[3] + padY, 0, frameHeight),
  ];
}

function insetBox(
  box: Box,
  insetRatio: number,
  frameWidth: number,
  frameHeight: number,
): Box {
  const width = box[2] - box[0];
  const height = box[3] - box[1];
  const insetX = width * insetRatio;
  const insetY = height * insetRatio;

  const result: Box = [
    clamp(box[0] + insetX, 0, frameWidth),
    clamp(box[1] + insetY, 0, frameHeight),
    clamp(box[2] - insetX, 0, frameWidth),
    clamp(box[3] - insetY, 0, frameHeight),
  ];

  if (result[2] <= result[0] || result[3] <= result[1]) {
    return box;
  }

  return result;
}

function boxCenterInside(inner: Box, outer: Box): boolean {
  const centerX = (inner[0] + inner[2]) / 2;
  const centerY = (inner[1] + inner[3]) / 2;

  return (
    centerX >= outer[0]
    && centerX <= outer[2]
    && centerY >= outer[1]
    && centerY <= outer[3]
  );
}

function handBoxFromLandmarks(
  landmarks: Landmark[],
  frameWidth: number,
  frameHeight: number,
): Box | null {
  if (!landmarks || landmarks.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const landmark of landmarks) {
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
      continue;
    }

    const x = clamp(landmark.x * frameWidth, 0, frameWidth);
    const y = clamp(landmark.y * frameHeight, 0, frameHeight);

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (
    !Number.isFinite(minX)
    || !Number.isFinite(minY)
    || !Number.isFinite(maxX)
    || !Number.isFinite(maxY)
    || maxX <= minX
    || maxY <= minY
  ) {
    return null;
  }

  return expandBox(
    [minX, minY, maxX, maxY],
    HAND_BOX_PADDING,
    frameWidth,
    frameHeight,
  );
}

function findPersonIndexForHand(
  handBox: Box,
  people: PPEDetection[],
): number | null {
  const containing: Array<{ index: number; area: number }> = [];

  people.forEach((person, index) => {
    if (boxCenterInside(handBox, person.xyxy)) {
      containing.push({
        index,
        area: boxArea(person.xyxy),
      });
    }
  });

  if (containing.length > 0) {
    containing.sort((a, b) => a.area - b.area);
    return containing[0].index;
  }

  const handArea = boxArea(handBox);
  if (handArea <= 0) {
    return null;
  }

  let bestIndex: number | null = null;
  let bestOverlap = 0;

  people.forEach((person, index) => {
    const overlap = intersectionArea(handBox, person.xyxy) / handArea;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIndex = index;
    }
  });

  return bestOverlap >= 0.35 ? bestIndex : null;
}

function gloveMatchesHand(
  gloveBox: Box,
  handBox: Box,
  frameWidth: number,
  frameHeight: number,
): boolean {
  const expandedHand = expandBox(
    handBox,
    GLOVE_SEARCH_PADDING,
    frameWidth,
    frameHeight,
  );

  if (boxCenterInside(gloveBox, expandedHand)) {
    return true;
  }

  const overlap = intersectionArea(gloveBox, expandedHand);
  if (overlap <= 0) {
    return false;
  }

  const smallerArea = Math.min(
    boxArea(gloveBox),
    boxArea(expandedHand),
  );

  return (
    smallerArea > 0
    && overlap / smallerArea >= MIN_GLOVE_HAND_OVERLAP
  );
}

function isSkinLikePixel(r: number, g: number, b: number): boolean {
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);

  // Reject very dark pixels and nearly gray/achromatic materials first.
  if (maximum < 40 || maximum - minimum < 8) {
    return false;
  }

  // Broad YCbCr skin region. This is intentionally permissive across a wide
  // range of skin tones, while still rejecting most gray/blue/black gloves.
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

  return (
    y >= 35
    && cb >= 72
    && cb <= 148
    && cr >= 124
    && cr <= 184
  );
}

function inferenceScore(skinRatio: number): number {
  const normalized = clamp(
    (skinRatio - MIN_SKIN_PIXEL_RATIO)
      / (STRONG_SKIN_PIXEL_RATIO - MIN_SKIN_PIXEL_RATIO),
    0,
    1,
  );

  return (
    MIN_INFERENCE_SCORE
    + (MAX_INFERENCE_SCORE - MIN_INFERENCE_SCORE) * normalized
  );
}

export class BrowserGloveInference {
  private landmarker: HandLandmarker | null = null;
  private loadingPromise: Promise<void> | null = null;
  private runningMode: "IMAGE" | "VIDEO" = "IMAGE";
  private lastVideoTimestamp = -1;

  private readonly analysisCanvas: HTMLCanvasElement;
  private readonly analysisContext: CanvasRenderingContext2D;

  constructor() {
    this.analysisCanvas = document.createElement("canvas");
    this.analysisCanvas.width = HAND_ANALYSIS_SIZE;
    this.analysisCanvas.height = HAND_ANALYSIS_SIZE;

    const context = this.analysisCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!context) {
      throw new Error(
        "SafeVision could not create the hand-analysis canvas.",
      );
    }

    this.analysisContext = context;
  }

  async load(): Promise<void> {
    if (this.landmarker) {
      return;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.loadInternal();

    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async loadInternal(): Promise<void> {
    console.log("[SafeVision] Loading browser hand landmark model...");

    const vision = await FilesetResolver.forVisionTasks(
      MEDIAPIPE_WASM_ROOT,
    );

    this.landmarker = await HandLandmarker.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        numHands: MAX_HANDS,
        minHandDetectionConfidence: MIN_HAND_DETECTION_CONFIDENCE,
        minHandPresenceConfidence: MIN_HAND_PRESENCE_CONFIDENCE,
        minTrackingConfidence: MIN_TRACKING_CONFIDENCE,
      },
    );

    this.runningMode = "IMAGE";
    console.log("[SafeVision] Hand landmark model loaded.");
  }

  async startSession(mode: GloveInferenceMode): Promise<void> {
    await this.load();
    await this.ensureMode(mode);

    if (mode === "video") {
      this.lastVideoTimestamp = -1;
    }
  }

  private async ensureMode(mode: GloveInferenceMode): Promise<void> {
    await this.load();

    if (!this.landmarker) {
      throw new Error("Hand landmark model is not loaded.");
    }

    const requiredMode: "IMAGE" | "VIDEO" =
      mode === "image" ? "IMAGE" : "VIDEO";

    if (this.runningMode === requiredMode) {
      return;
    }

    await this.landmarker.setOptions({
      runningMode: requiredMode,
    });

    this.runningMode = requiredMode;
    this.lastVideoTimestamp = -1;
  }

  private skinPixelRatio(
    source: HTMLImageElement | HTMLVideoElement,
    handBox: Box,
    frameWidth: number,
    frameHeight: number,
  ): number {
    const sampleBox = insetBox(
      handBox,
      0.08,
      frameWidth,
      frameHeight,
    );

    const sourceX = Math.max(0, Math.floor(sampleBox[0]));
    const sourceY = Math.max(0, Math.floor(sampleBox[1]));
    const sourceWidth = Math.max(1, Math.ceil(sampleBox[2] - sampleBox[0]));
    const sourceHeight = Math.max(1, Math.ceil(sampleBox[3] - sampleBox[1]));

    this.analysisContext.clearRect(
      0,
      0,
      HAND_ANALYSIS_SIZE,
      HAND_ANALYSIS_SIZE,
    );

    this.analysisContext.drawImage(
      source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      HAND_ANALYSIS_SIZE,
      HAND_ANALYSIS_SIZE,
    );

    const pixels = this.analysisContext.getImageData(
      0,
      0,
      HAND_ANALYSIS_SIZE,
      HAND_ANALYSIS_SIZE,
    ).data;

    let validPixels = 0;
    let skinPixels = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha < 128) {
        continue;
      }

      validPixels += 1;

      if (
        isSkinLikePixel(
          pixels[index],
          pixels[index + 1],
          pixels[index + 2],
        )
      ) {
        skinPixels += 1;
      }
    }

    if (validPixels === 0) {
      return 0;
    }

    return skinPixels / validPixels;
  }

  async inferNoGloves(
    source: HTMLImageElement | HTMLVideoElement,
    frameWidth: number,
    frameHeight: number,
    ppeDetections: PPEDetection[],
    mode: GloveInferenceMode,
    timestampMs?: number,
  ): Promise<PPEDetection[]> {
    await this.ensureMode(mode);

    if (!this.landmarker) {
      return [];
    }

    const people = ppeDetections.filter(
      detection => detection.className === "person",
    );

    if (people.length === 0) {
      return [];
    }

    const gloves = ppeDetections.filter(
      detection => detection.className === "gloves",
    );

    let result;

    if (mode === "image") {
      result = this.landmarker.detect(source);
    } else {
      const requestedTimestamp = Math.max(
        0,
        Math.round(timestampMs ?? performance.now()),
      );

      const safeTimestamp =
        requestedTimestamp <= this.lastVideoTimestamp
          ? this.lastVideoTimestamp + 1
          : requestedTimestamp;

      this.lastVideoTimestamp = safeTimestamp;
      result = this.landmarker.detectForVideo(source, safeTimestamp);
    }

    const bestViolationByPerson = new Map<number, PPEDetection>();

    for (const landmarks of result.landmarks) {
      const handBox = handBoxFromLandmarks(
        landmarks,
        frameWidth,
        frameHeight,
      );

      if (!handBox) {
        continue;
      }

      const handWidth = handBox[2] - handBox[0];
      const handHeight = handBox[3] - handBox[1];
      const minimumHandPixels = Math.max(
        12,
        Math.min(frameWidth, frameHeight) * MIN_HAND_SIZE_RATIO,
      );

      if (
        handWidth < minimumHandPixels
        || handHeight < minimumHandPixels
      ) {
        continue;
      }

      const personIndex = findPersonIndexForHand(handBox, people);
      if (personIndex === null) {
        continue;
      }

      const hasDetectedGlove = gloves.some(
        glove => gloveMatchesHand(
          glove.xyxy,
          handBox,
          frameWidth,
          frameHeight,
        ),
      );

      if (hasDetectedGlove) {
        continue;
      }

      const skinRatio = this.skinPixelRatio(
        source,
        handBox,
        frameWidth,
        frameHeight,
      );

      if (skinRatio < MIN_SKIN_PIXEL_RATIO) {
        console.debug(
          "[SafeVision] Visible hand suppressed as NO-Gloves because exposed-skin evidence was too low:",
          Math.round(skinRatio * 100),
          "%",
        );
        continue;
      }

      const synthetic: PPEDetection = {
        classId: -1,
        rawClassName: "NO-Gloves (inferred)",
        className: "no_gloves",
        confidence: inferenceScore(skinRatio),
        xyxy: handBox,
      };

      const existing = bestViolationByPerson.get(personIndex);
      if (!existing || synthetic.confidence > existing.confidence) {
        bestViolationByPerson.set(personIndex, synthetic);
      }
    }

    return Array.from(bestViolationByPerson.values());
  }
}

export const gloveInference = new BrowserGloveInference();
