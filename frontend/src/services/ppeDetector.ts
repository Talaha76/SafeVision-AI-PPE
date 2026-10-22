import * as ort from "onnxruntime-web/wasm";

const MODEL_URL = "/models/ppe.onnx";
const MODEL_SIZE = 640;
const PREDICTION_COUNT = 8400;

/*
 * ONNX Runtime Web configuration.
 *
 * The actual WebAssembly binary is stored at:
 *
 * frontend/public/ort/ort-wasm-simd-threaded.wasm
 *
 * Vite and Netlify expose that file as:
 *
 * /ort/ort-wasm-simd-threaded.wasm
 */
ort.env.wasm.numThreads = 1;

ort.env.wasm.wasmPaths = {
  wasm: "/ort/ort-wasm-simd-threaded.wasm",
};

export const PPE_CLASS_NAMES = [
  "Excavator",
  "Gloves",
  "Hardhat",
  "Ladder",
  "Mask",
  "NO-Hardhat",
  "NO-Mask",
  "NO-Safety Vest",
  "Person",
  "SUV",
  "Safety Cone",
  "Safety Vest",
  "bus",
  "dump truck",
  "fire hydrant",
  "machinery",
  "mini-van",
  "sedan",
  "semi",
  "trailer",
  "truck and trailer",
  "truck",
  "van",
  "vehicle",
  "wheel loader",
] as const;

export type PPEDetection = {
  classId: number;
  rawClassName: string;
  className: string;
  confidence: number;
  xyxy: [number, number, number, number];
};

function normalizeClassName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  const aliases: Record<string, string> = {
    hardhat: "hardhat",
    "safety vest": "vest",
    gloves: "gloves",
    mask: "mask",
    person: "person",
    "no hardhat": "no_hardhat",
    "no safety vest": "no_vest",
    "no mask": "no_mask",
  };

  return aliases[normalized] ?? normalized.replace(/\s+/g, "_");
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.max(
    minimum,
    Math.min(maximum, value),
  );
}

function calculateIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const intersectionX1 = Math.max(a[0], b[0]);
  const intersectionY1 = Math.max(a[1], b[1]);
  const intersectionX2 = Math.min(a[2], b[2]);
  const intersectionY2 = Math.min(a[3], b[3]);

  const intersectionWidth = Math.max(
    0,
    intersectionX2 - intersectionX1,
  );

  const intersectionHeight = Math.max(
    0,
    intersectionY2 - intersectionY1,
  );

  const intersectionArea =
    intersectionWidth * intersectionHeight;

  const areaA =
    Math.max(0, a[2] - a[0]) *
    Math.max(0, a[3] - a[1]);

  const areaB =
    Math.max(0, b[2] - b[0]) *
    Math.max(0, b[3] - b[1]);

  const union =
    areaA +
    areaB -
    intersectionArea;

  if (union <= 0) {
    return 0;
  }

  return intersectionArea / union;
}

function nonMaxSuppression(
  detections: PPEDetection[],
  iouThreshold: number,
  maxDetections = 300,
): PPEDetection[] {
  const sorted = [...detections].sort(
    (a, b) => b.confidence - a.confidence,
  );

  const kept: PPEDetection[] = [];

  for (const candidate of sorted) {
    if (kept.length >= maxDetections) {
      break;
    }

    let shouldKeep = true;

    for (const existing of kept) {
      /*
       * Class-aware NMS.
       *
       * A Person box should not suppress
       * a Hardhat, Mask, Vest, etc.
       */
      if (existing.classId !== candidate.classId) {
        continue;
      }

      const overlap = calculateIoU(
        existing.xyxy,
        candidate.xyxy,
      );

      if (overlap >= iouThreshold) {
        shouldKeep = false;
        break;
      }
    }

    if (shouldKeep) {
      kept.push(candidate);
    }
  }

  return kept;
}

export class BrowserPPEDetector {
  private session: ort.InferenceSession | null = null;

  private loadingPromise: Promise<void> | null = null;

  private readonly canvas: HTMLCanvasElement;

  private readonly context: CanvasRenderingContext2D;

  public executionProvider = "not-loaded";

  constructor() {
    this.canvas = document.createElement("canvas");

    this.canvas.width = MODEL_SIZE;
    this.canvas.height = MODEL_SIZE;

    const context = this.canvas.getContext(
      "2d",
      {
        willReadFrequently: true,
      },
    );

    if (!context) {
      throw new Error(
        "SafeVision could not create the preprocessing canvas.",
      );
    }

    this.context = context;
  }

  async load(): Promise<void> {
    if (this.session) {
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
    console.log(
      "[SafeVision] Starting PPE model load...",
    );

    console.log(
      `[SafeVision] Model URL: ${MODEL_URL}`,
    );

    const startedAt = performance.now();

    try {
      /*
       * Browser-side ONNX inference.
       *
       * This does NOT contact Render.
       *
       * The browser loads:
       *
       * /models/ppe.onnx
       *
       * and executes it using:
       *
       * ONNX Runtime Web + WASM.
       */
      this.session =
        await ort.InferenceSession.create(
          MODEL_URL,
          {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
          },
        );

      this.executionProvider = "wasm";

      const elapsed =
        performance.now() - startedAt;

      console.log(
        `[SafeVision] PPE model loaded successfully with WASM in ${Math.round(
          elapsed,
        )} ms.`,
      );

      console.log(
        "[SafeVision] Model inputs:",
        this.session.inputNames,
      );

      console.log(
        "[SafeVision] Model outputs:",
        this.session.outputNames,
      );
    } catch (error) {
      this.session = null;

      console.error(
        "[SafeVision] PPE model failed to load:",
        error,
      );

      if (error instanceof Error) {
        throw new Error(
          `Could not load PPE model: ${error.message}`,
        );
      }

      throw new Error(
        "Could not load PPE model.",
      );
    }
  }

  async detect(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    confidenceThreshold = 0.35,
    iouThreshold = 0.45,
  ): Promise<PPEDetection[]> {
    console.log(
      "[SafeVision] Detection requested.",
    );

    console.log(
      `[SafeVision] Source size: ${sourceWidth}x${sourceHeight}`,
    );

    await this.load();

    if (!this.session) {
      throw new Error(
        "SafeVision PPE model is not loaded.",
      );
    }

    if (
      sourceWidth <= 0 ||
      sourceHeight <= 0
    ) {
      throw new Error(
        `Invalid source dimensions: ${sourceWidth}x${sourceHeight}`,
      );
    }

    console.log(
      "[SafeVision] Preprocessing image...",
    );

    const {
      tensor,
      scale,
      padX,
      padY,
    } = this.preprocess(
      source,
      sourceWidth,
      sourceHeight,
    );

    const inputName =
      this.session.inputNames[0];

    const outputName =
      this.session.outputNames[0];

    if (!inputName) {
      throw new Error(
        "The ONNX model has no input.",
      );
    }

    if (!outputName) {
      throw new Error(
        "The ONNX model has no output.",
      );
    }

    console.log(
      `[SafeVision] ONNX input: ${inputName}`,
    );

    console.log(
      "[SafeVision] Running ONNX inference...",
    );

    const inferenceStartedAt =
      performance.now();

    let results;

    try {
      results =
        await this.session.run({
          [inputName]: tensor,
        });
    } catch (error) {
      console.error(
        "[SafeVision] ONNX inference failed:",
        error,
      );

      if (error instanceof Error) {
        throw new Error(
          `PPE inference failed: ${error.message}`,
        );
      }

      throw new Error(
        "PPE inference failed.",
      );
    }

    const inferenceElapsed =
      performance.now() -
      inferenceStartedAt;

    console.log(
      `[SafeVision] Inference completed in ${Math.round(
        inferenceElapsed,
      )} ms.`,
    );

    const output =
      results[outputName];

    if (!output) {
      throw new Error(
        `ONNX did not return output "${outputName}".`,
      );
    }

    const dimensions =
      output.dims.map(Number);

    console.log(
      "[SafeVision] Output shape:",
      dimensions,
    );

    /*
     * Your exported PPE model:
     *
     * INPUT
     * [1, 3, 640, 640]
     *
     * OUTPUT
     * [1, 29, 8400]
     *
     * 29 =
     * 4 box values
     * +
     * 25 class confidence values
     */
    if (
      dimensions.length !== 3 ||
      dimensions[0] !== 1 ||
      dimensions[1] !== 29 ||
      dimensions[2] !== PREDICTION_COUNT
    ) {
      throw new Error(
        `Unexpected ONNX output shape: [${dimensions.join(
          ", ",
        )}]. Expected [1, 29, 8400].`,
      );
    }

    /*
     * Your model reports tensor(float),
     * so its output should be Float32Array.
     *
     * Runtime checking avoids unsafe
     * TypeScript casting.
     */
    const outputData =
      output.data;

    if (
      !(
        outputData
        instanceof Float32Array
      )
    ) {
      const receivedType =
        outputData?.constructor?.name ??
        typeof outputData;

      throw new Error(
        `Unexpected ONNX output data type. Expected Float32Array but received ${receivedType}.`,
      );
    }

    console.log(
      "[SafeVision] Decoding detections...",
    );

    const detections =
      this.decode(
        outputData,
        sourceWidth,
        sourceHeight,
        scale,
        padX,
        padY,
        confidenceThreshold,
        iouThreshold,
      );

    console.log(
      `[SafeVision] ${detections.length} detections after NMS.`,
    );

    console.table(
      detections.map(
        detection => ({
          class:
            detection.rawClassName,

          confidence:
            `${Math.round(
              detection.confidence * 100,
            )}%`,

          x1:
            Math.round(
              detection.xyxy[0],
            ),

          y1:
            Math.round(
              detection.xyxy[1],
            ),

          x2:
            Math.round(
              detection.xyxy[2],
            ),

          y2:
            Math.round(
              detection.xyxy[3],
            ),
        }),
      ),
    );

    return detections;
  }

  private preprocess(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
  ): {
    tensor: ort.Tensor;
    scale: number;
    padX: number;
    padY: number;
  } {
    /*
     * Preserve aspect ratio while fitting
     * the image into the model's 640x640
     * input.
     */
    const scale = Math.min(
      MODEL_SIZE / sourceWidth,
      MODEL_SIZE / sourceHeight,
    );

    const resizedWidth =
      sourceWidth * scale;

    const resizedHeight =
      sourceHeight * scale;

    const padX =
      (
        MODEL_SIZE -
        resizedWidth
      ) / 2;

    const padY =
      (
        MODEL_SIZE -
        resizedHeight
      ) / 2;

    /*
     * Ultralytics-style letterbox background.
     */
    this.context.fillStyle =
      "rgb(114, 114, 114)";

    this.context.fillRect(
      0,
      0,
      MODEL_SIZE,
      MODEL_SIZE,
    );

    this.context.drawImage(
      source,

      0,
      0,
      sourceWidth,
      sourceHeight,

      padX,
      padY,
      resizedWidth,
      resizedHeight,
    );

    const imageData =
      this.context.getImageData(
        0,
        0,
        MODEL_SIZE,
        MODEL_SIZE,
      );

    const pixels =
      imageData.data;

    const planeSize =
      MODEL_SIZE *
      MODEL_SIZE;

    const tensorData =
      new Float32Array(
        3 * planeSize,
      );

    /*
     * Canvas:
     *
     * RGBA RGBA RGBA ...
     *
     * ONNX model:
     *
     * [1, 3, 640, 640]
     *
     * RGB
     * CHW
     * Float32
     * normalized 0..1
     */
    for (
      let pixelIndex = 0;
      pixelIndex < planeSize;
      pixelIndex++
    ) {
      const rgbaIndex =
        pixelIndex * 4;

      /*
       * R
       */
      tensorData[
        pixelIndex
      ] =
        pixels[
          rgbaIndex
        ] / 255;

      /*
       * G
       */
      tensorData[
        planeSize +
        pixelIndex
      ] =
        pixels[
          rgbaIndex + 1
        ] / 255;

      /*
       * B
       */
      tensorData[
        planeSize * 2 +
        pixelIndex
      ] =
        pixels[
          rgbaIndex + 2
        ] / 255;
    }

    const tensor =
      new ort.Tensor(
        "float32",
        tensorData,
        [
          1,
          3,
          MODEL_SIZE,
          MODEL_SIZE,
        ],
      );

    return {
      tensor,
      scale,
      padX,
      padY,
    };
  }

  private decode(
    output: Float32Array,
    sourceWidth: number,
    sourceHeight: number,
    scale: number,
    padX: number,
    padY: number,
    confidenceThreshold: number,
    iouThreshold: number,
  ): PPEDetection[] {
    const classCount =
      PPE_CLASS_NAMES.length;

    const candidates:
      PPEDetection[] = [];

    /*
     * ONNX output:
     *
     * [1, 29, 8400]
     *
     * row 0 = center X
     * row 1 = center Y
     * row 2 = width
     * row 3 = height
     *
     * rows 4-28 =
     * 25 class confidence scores
     */
    for (
      let predictionIndex = 0;
      predictionIndex <
      PREDICTION_COUNT;
      predictionIndex++
    ) {
      let bestClassId =
        -1;

      let bestConfidence =
        0;

      /*
       * Find the strongest class score
       * for this candidate.
       */
      for (
        let classId = 0;
        classId < classCount;
        classId++
      ) {
        const classRow =
          4 + classId;

        const score =
          output[
            classRow *
            PREDICTION_COUNT +
            predictionIndex
          ];

        if (
          score >
          bestConfidence
        ) {
          bestConfidence =
            score;

          bestClassId =
            classId;
        }
      }

      if (
        bestClassId < 0 ||
        bestConfidence <
        confidenceThreshold
      ) {
        continue;
      }

      /*
       * YOLO model-space box:
       *
       * x center
       * y center
       * width
       * height
       */
      const centerX =
        output[
          predictionIndex
        ];

      const centerY =
        output[
          PREDICTION_COUNT +
          predictionIndex
        ];

      const width =
        output[
          PREDICTION_COUNT * 2 +
          predictionIndex
        ];

      const height =
        output[
          PREDICTION_COUNT * 3 +
          predictionIndex
        ];

      /*
       * Convert xywh to xyxy.
       */
      const modelX1 =
        centerX -
        width / 2;

      const modelY1 =
        centerY -
        height / 2;

      const modelX2 =
        centerX +
        width / 2;

      const modelY2 =
        centerY +
        height / 2;

      /*
       * Remove letterbox padding
       * and map coordinates back
       * to the original image.
       */
      const x1 =
        clamp(
          (
            modelX1 -
            padX
          ) / scale,

          0,
          sourceWidth,
        );

      const y1 =
        clamp(
          (
            modelY1 -
            padY
          ) / scale,

          0,
          sourceHeight,
        );

      const x2 =
        clamp(
          (
            modelX2 -
            padX
          ) / scale,

          0,
          sourceWidth,
        );

      const y2 =
        clamp(
          (
            modelY2 -
            padY
          ) / scale,

          0,
          sourceHeight,
        );

      if (
        x2 <= x1 ||
        y2 <= y1
      ) {
        continue;
      }

      const rawClassName =
        PPE_CLASS_NAMES[
          bestClassId
        ];

      candidates.push({
        classId:
          bestClassId,

        rawClassName,

        className:
          normalizeClassName(
            rawClassName,
          ),

        confidence:
          bestConfidence,

        xyxy: [
          x1,
          y1,
          x2,
          y2,
        ],
      });
    }

    /*
     * Remove duplicate overlapping
     * detections.
     */
    return nonMaxSuppression(
      candidates,
      iouThreshold,
    );
  }
}

/*
 * One shared detector instance.
 *
 * The model loads on the first detection
 * and stays loaded for future detections.
 */
export const ppeDetector =
  new BrowserPPEDetector();