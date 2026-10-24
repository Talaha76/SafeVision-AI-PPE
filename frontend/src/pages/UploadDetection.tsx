// ============================================================
// SAFEVISION AI — UPLOAD DETECTION
// ============================================================
//
// Analyzes uploaded images and videos in the browser for PPE
// violations and produces detection results and timelines
// without creating dashboard incidents.
//
// ============================================================

import {
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ppeDetector,
  type PPEDetection,
} from "../services/ppeDetector";

import {
  gloveInference,
} from "../services/gloveInference";

import "./UploadDetection.css";


type Box = [
  number,
  number,
  number,
  number
];


type PersonDetection = {
  track_id: number;
  confidence: number;
  box: Box;
};


type Detection = {
  class_name: string;
  confidence: number;
  box: Box;
};


type ViolationDetection = {
  track_id: number | null;
  missing_ppe: string;
  violation_type: string;
  confidence: number;
  person_box: Box | null;
  violation_box: Box;
};


type DetectionResult = {
  frame_width: number;
  frame_height: number;
  people: PersonDetection[];
  detections: Detection[];
  violations: ViolationDetection[];
  error?: string;
};


type ActiveViolationEvent = {
  key: string;
  track_id: number | null;
  missing_ppe: string;
  start_time: number;
  end_time: number;
  last_seen: number;
  confidence: number;
};


type ViolationEvent = {
  id: string;
  track_id: number | null;
  missing_ppe: string;
  start_time: number;
  end_time: number;
  confidence: number;
};


type VideoSummary = {
  duration: number;
  people_tracked: number;
  events: ViolationEvent[];
};


type BrowserTrack = {
  track_id: number;
  box: Box;
  last_seen_frame: number;
};


const VIDEO_SAMPLE_SECONDS = 0.5;
const EVENT_GAP_SECONDS = 1.25;

const PERSON_TRACK_IOU_THRESHOLD = 0.15;
const TRACK_MAX_MISSED_FRAMES = 4;

const GLOVE_VIDEO_CONFIRM_FRAMES = 2;


function normalizeClassName(
  value: string
) {
  return value
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
}


function missingPpeFromClass(
  className: string
): string | null {
  const normalized =
    normalizeClassName(className);

  const map:
    Record<string, string> = {
      no_hardhat: "hardhat",
      no_mask: "mask",
      no_safety_vest: "vest",
      no_vest: "vest",
      no_gloves: "gloves",
    };

  return map[normalized] ?? null;
}


function positivePpeLabel(
  className: string
): string | null {
  const normalized =
    normalizeClassName(className);

  const map:
    Record<string, string> = {
      hardhat: "Hardhat",
      mask: "Mask",
      safety_vest: "Vest",
      vest: "Vest",
      gloves: "Gloves",
    };

  return map[normalized] ?? null;
}


function formatPpe(
  value: string
) {
  const labels:
    Record<string, string> = {
      hardhat: "Hardhat",
      vest: "Vest",
      mask: "Mask",
      gloves: "Gloves",
    };

  return labels[value]
    ?? value
      .replace(/_/g, " ")
      .replace(/\b\w/g, letter =>
        letter.toUpperCase()
      );
}


function formatTimestamp(
  seconds: number
) {
  const safe = Math.max(
    0,
    Math.floor(seconds)
  );

  const hours = Math.floor(
    safe / 3600
  );

  const minutes = Math.floor(
    (safe % 3600) / 60
  );

  const secs = safe % 60;

  if (hours > 0) {
    return [
      hours,
      minutes,
      secs,
    ]
      .map(value =>
        String(value).padStart(2, "0")
      )
      .join(":");
  }

  return [
    minutes,
    secs,
  ]
    .map(value =>
      String(value).padStart(2, "0")
    )
    .join(":");
}


function formatEventTime(
  event: ViolationEvent
) {
  if (
    event.end_time
    - event.start_time
    < 0.75
  ) {
    return formatTimestamp(
      event.start_time
    );
  }

  return (
    `${formatTimestamp(event.start_time)}`
    + " – "
    + `${formatTimestamp(event.end_time)}`
  );
}


function boxArea(
  box: Box
) {
  return (
    Math.max(0, box[2] - box[0])
    * Math.max(0, box[3] - box[1])
  );
}


function intersectionArea(
  a: Box,
  b: Box
) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);

  return (
    Math.max(0, x2 - x1)
    * Math.max(0, y2 - y1)
  );
}


function boxIou(
  a: Box,
  b: Box
) {
  const intersection =
    intersectionArea(a, b);

  const union =
    boxArea(a)
    + boxArea(b)
    - intersection;

  if (union <= 0) {
    return 0;
  }

  return intersection / union;
}


function boxCenterInside(
  inner: Box,
  outer: Box
) {
  const centerX =
    (inner[0] + inner[2]) / 2;

  const centerY =
    (inner[1] + inner[3]) / 2;

  return (
    centerX >= outer[0]
    && centerX <= outer[2]
    && centerY >= outer[1]
    && centerY <= outer[3]
  );
}


export default function UploadDetection() {
  const imageRef =
    useRef<HTMLImageElement | null>(null);

  const videoRef =
    useRef<HTMLVideoElement | null>(null);

  const overlayRef =
    useRef<HTMLCanvasElement | null>(null);

  const busyRef =
    useRef(false);

  const objectUrlRef =
    useRef<string | null>(null);

  const analysisActiveRef =
    useRef(false);

  const pendingTimestampRef =
    useRef(0);

  const pendingSeekRef =
    useRef(false);

  const videoDurationRef =
    useRef(0);

  const trackedPeopleRef =
    useRef<Set<number>>(new Set());

  const activeEventsRef =
    useRef<Map<string, ActiveViolationEvent>>(
      new Map()
    );

  const completedEventsRef =
    useRef<ViolationEvent[]>([]);

  const gloveVideoStreaksRef =
    useRef<Map<string, number>>(
      new Map()
    );

  const browserTracksRef =
    useRef<Map<number, BrowserTrack>>(
      new Map()
    );

  const nextTrackIdRef =
    useRef(1);

  const videoFrameIndexRef =
    useRef(0);

  const runIdRef =
    useRef(0);


  const [file, setFile] =
    useState<File | null>(null);

  const [mediaType, setMediaType] =
    useState<"image" | "video" | null>(null);

  const [mediaUrl, setMediaUrl] =
    useState("");

  const [aspectRatio, setAspectRatio] =
    useState("16 / 9");

  const [detecting, setDetecting] =
    useState(false);

  const [error, setError] =
    useState("");

  const [result, setResult] =
    useState<DetectionResult | null>(null);

  const [videoSummary, setVideoSummary] =
    useState<VideoSummary | null>(null);

  const [videoProgress, setVideoProgress] =
    useState(0);


  function clearOverlay() {
    const canvas = overlayRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );
  }


  function resetBrowserTracker() {
    browserTracksRef.current =
      new Map<number, BrowserTrack>();

    nextTrackIdRef.current = 1;
    videoFrameIndexRef.current = 0;
  }


  function resetVideoAccumulator() {
    trackedPeopleRef.current =
      new Set<number>();

    activeEventsRef.current =
      new Map<string, ActiveViolationEvent>();

    completedEventsRef.current = [];

    gloveVideoStreaksRef.current =
      new Map<string, number>();

    pendingTimestampRef.current = 0;
    pendingSeekRef.current = false;
    videoDurationRef.current = 0;

    resetBrowserTracker();

    setVideoProgress(0);
    setVideoSummary(null);
  }


  function cancelDetection() {
    analysisActiveRef.current = false;
    busyRef.current = false;
    pendingSeekRef.current = false;

    runIdRef.current += 1;

    setDetecting(false);
  }


  function handleFile(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const selected =
      event.target.files?.[0];

    if (!selected) return;

    cancelDetection();
    clearOverlay();
    resetVideoAccumulator();

    setResult(null);
    setError("");

    if (objectUrlRef.current) {
      URL.revokeObjectURL(
        objectUrlRef.current
      );
    }

    const url =
      URL.createObjectURL(selected);

    objectUrlRef.current = url;

    setFile(selected);
    setMediaUrl(url);

    if (
      selected.type.startsWith("image/")
    ) {
      setMediaType("image");
    } else if (
      selected.type.startsWith("video/")
    ) {
      setMediaType("video");
    } else {
      setFile(null);
      setMediaType(null);

      setError(
        "Please upload an image or video file."
      );
    }
  }


  function drawLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string,
    fontSize: number
  ) {
    ctx.font =
      `700 ${fontSize}px Arial`;

    const paddingX = 7;
    const paddingY = 5;

    const width =
      ctx.measureText(text).width
      + paddingX * 2;

    const height =
      fontSize + paddingY * 2;

    const labelX = Math.max(
      0,
      Math.min(
        x,
        ctx.canvas.width - width
      )
    );

    const labelY = Math.max(
      0,
      y - height
    );

    ctx.fillStyle = color;
    ctx.fillRect(
      labelX,
      labelY,
      width,
      height
    );

    ctx.fillStyle = "#ffffff";
    ctx.fillText(
      text,
      labelX + paddingX,
      labelY + fontSize + 2
    );
  }


  function drawResults(
    data: DetectionResult
  ) {
    const canvas = overlayRef.current;

    if (!canvas) return;

    canvas.width = data.frame_width;
    canvas.height = data.frame_height;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const lineWidth = Math.max(
      2,
      Math.round(canvas.width / 450)
    );

    const fontSize = Math.max(
      13,
      Math.round(canvas.width / 70)
    );

    ctx.lineWidth = lineWidth;

    const violatingPeople =
      new Map<number, Box>();

    data.violations.forEach(
      violation => {
        if (
          violation.track_id !== null
          && violation.person_box
        ) {
          violatingPeople.set(
            violation.track_id,
            violation.person_box
          );
        }
      }
    );

    violatingPeople.forEach(
      (box, trackId) => {
        const [x1, y1, x2, y2] = box;

        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = lineWidth;

        ctx.strokeRect(
          x1,
          y1,
          x2 - x1,
          y2 - y1
        );

        drawLabel(
          ctx,
          `Person / Track #${trackId}`,
          x1,
          y1,
          "#2563eb",
          fontSize
        );
      }
    );

    data.violations.forEach(
      violation => {
        const [x1, y1, x2, y2] =
          violation.violation_box;

        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = lineWidth;

        ctx.strokeRect(
          x1,
          y1,
          x2 - x1,
          y2 - y1
        );

        const violationLabel =
          violation.missing_ppe === "gloves"
            ? "Missing Gloves (inferred)"
            : `Missing ${formatPpe(
                violation.missing_ppe
              )} ${Math.round(
                violation.confidence * 100
              )}%`;

        drawLabel(
          ctx,
          violationLabel,
          x1,
          y1,
          "#dc2626",
          fontSize
        );
      }
    );
  }


  function trackPeople(
    detections: PPEDetection[],
    frameIndex: number
  ): PersonDetection[] {
    const personCandidates =
      detections
        .filter(
          detection =>
            normalizeClassName(
              detection.className
            ) === "person"
        )
        .sort(
          (a, b) =>
            b.confidence
            - a.confidence
        );

    const usedTrackIds =
      new Set<number>();

    const people:
      PersonDetection[] = [];

    for (
      const candidate
      of personCandidates
    ) {
      const candidateBox:
        Box = [...candidate.xyxy];

      let bestTrackId:
        number | null = null;

      let bestIou = 0;

      for (
        const [
          trackId,
          track,
        ]
        of browserTracksRef.current.entries()
      ) {
        if (
          usedTrackIds.has(trackId)
          || frameIndex
            - track.last_seen_frame
            > TRACK_MAX_MISSED_FRAMES
        ) {
          continue;
        }

        const overlap =
          boxIou(
            candidateBox,
            track.box
          );

        if (overlap > bestIou) {
          bestIou = overlap;
          bestTrackId = trackId;
        }
      }

      let trackId: number;

      if (
        bestTrackId !== null
        && bestIou
          >= PERSON_TRACK_IOU_THRESHOLD
      ) {
        trackId = bestTrackId;
      } else {
        trackId =
          nextTrackIdRef.current;

        nextTrackIdRef.current += 1;
      }

      usedTrackIds.add(trackId);

      browserTracksRef.current.set(
        trackId,
        {
          track_id: trackId,
          box: candidateBox,
          last_seen_frame: frameIndex,
        }
      );

      people.push({
        track_id: trackId,
        confidence:
          candidate.confidence,
        box: candidateBox,
      });
    }

    for (
      const [
        trackId,
        track,
      ]
      of browserTracksRef.current.entries()
    ) {
      if (
        frameIndex
        - track.last_seen_frame
        > TRACK_MAX_MISSED_FRAMES
      ) {
        browserTracksRef.current.delete(
          trackId
        );
      }
    }

    return people;
  }


  function findPersonForViolation(
    violationBox: Box,
    people: PersonDetection[]
  ): PersonDetection | null {
    const containing =
      people
        .filter(person =>
          boxCenterInside(
            violationBox,
            person.box
          )
        )
        .sort(
          (a, b) =>
            boxArea(a.box)
            - boxArea(b.box)
        );

    if (containing.length > 0) {
      return containing[0];
    }

    let bestPerson:
      PersonDetection | null = null;

    let bestOverlapRatio = 0;

    const violationArea =
      boxArea(violationBox);

    if (violationArea <= 0) {
      return null;
    }

    for (const person of people) {
      const overlapRatio =
        intersectionArea(
          violationBox,
          person.box
        ) / violationArea;

      if (
        overlapRatio
        > bestOverlapRatio
      ) {
        bestOverlapRatio =
          overlapRatio;

        bestPerson = person;
      }
    }

    if (bestOverlapRatio >= 0.05) {
      return bestPerson;
    }

    return null;
  }


  function buildDetectionResult(
    rawDetections: PPEDetection[],
    frameWidth: number,
    frameHeight: number,
    frameIndex: number
  ): DetectionResult {
    const people =
      trackPeople(
        rawDetections,
        frameIndex
      );

    const detections:
      Detection[] =
      rawDetections.map(
        detection => ({
          class_name:
            detection.className,
          confidence:
            detection.confidence,
          box:
            [...detection.xyxy] as Box,
        })
      );

    const strongestViolation =
      new Map<
        string,
        ViolationDetection
      >();

    for (
      const detection
      of rawDetections
    ) {
      const missingPpe =
        missingPpeFromClass(
          detection.className
        );

      if (!missingPpe) {
        continue;
      }

      const violationBox:
        Box = [...detection.xyxy];

      const person =
        findPersonForViolation(
          violationBox,
          people
        );

      const key =
        `${person?.track_id ?? "untracked"}`
        + `:${missingPpe}`;

      const violation:
        ViolationDetection = {
          track_id:
            person?.track_id ?? null,
          missing_ppe:
            missingPpe,
          violation_type:
            `missing_${missingPpe}`,
          confidence:
            detection.confidence,
          person_box:
            person?.box ?? null,
          violation_box:
            violationBox,
        };

      const existing =
        strongestViolation.get(key);

      if (
        !existing
        || violation.confidence
          > existing.confidence
      ) {
        strongestViolation.set(
          key,
          violation
        );
      }
    }

    return {
      frame_width: frameWidth,
      frame_height: frameHeight,
      people,
      detections,
      violations: [
        ...strongestViolation.values(),
      ],
    };
  }


  function violationKey(
    violation: ViolationDetection
  ) {
    if (violation.track_id !== null) {
      return (
        `track-${violation.track_id}`
        + `:${violation.missing_ppe}`
      );
    }

    const [x1, y1, x2, y2] =
      violation.violation_box;

    const centerX =
      (x1 + x2) / 2;

    const centerY =
      (y1 + y2) / 2;

    const bucketX = Math.round(
      centerX / 120
    );

    const bucketY = Math.round(
      centerY / 120
    );

    return (
      `untracked:${violation.missing_ppe}`
      + `:${bucketX}:${bucketY}`
    );
  }


  function completeActiveEvent(
    event: ActiveViolationEvent
  ) {
    completedEventsRef.current.push({
      id:
        `${event.key}:${event.start_time}`,
      track_id: event.track_id,
      missing_ppe: event.missing_ppe,
      start_time: event.start_time,
      end_time: event.end_time,
      confidence: event.confidence,
    });
  }


  function processVideoFrame(
    data: DetectionResult,
    timestamp: number
  ) {
    data.people.forEach(person => {
      trackedPeopleRef.current.add(
        person.track_id
      );
    });

    /*
     * NO-Gloves is inferred rather than trained.
     * For uploaded video, require it in two
     * consecutive sampled frames before turning
     * it into a timeline event.
     */
    const currentGloveKeys =
      new Set<string>();

    const confirmedViolations:
      ViolationDetection[] = [];

    data.violations.forEach(
      violation => {
        if (
          violation.missing_ppe
          !== "gloves"
        ) {
          confirmedViolations.push(
            violation
          );
          return;
        }

        const key =
          violationKey(violation);

        currentGloveKeys.add(key);

        const streak =
          (
            gloveVideoStreaksRef.current
              .get(key)
            ?? 0
          ) + 1;

        gloveVideoStreaksRef.current.set(
          key,
          streak
        );

        if (
          streak
          >= GLOVE_VIDEO_CONFIRM_FRAMES
        ) {
          confirmedViolations.push(
            violation
          );
        }
      }
    );

    for (
      const key
      of Array.from(
        gloveVideoStreaksRef.current.keys()
      )
    ) {
      if (
        !currentGloveKeys.has(key)
      ) {
        gloveVideoStreaksRef.current.delete(
          key
        );
      }
    }

    const currentKeys =
      new Set<string>();

    confirmedViolations.forEach(
      violation => {
        const key =
          violationKey(violation);

        currentKeys.add(key);

        const existing =
          activeEventsRef.current.get(
            key
          );

        if (
          existing
          && timestamp
            - existing.last_seen
            <= EVENT_GAP_SECONDS
        ) {
          existing.end_time = timestamp;
          existing.last_seen = timestamp;
          existing.confidence = Math.max(
            existing.confidence,
            violation.confidence
          );

          return;
        }

        if (existing) {
          completeActiveEvent(existing);
        }

        activeEventsRef.current.set(
          key,
          {
            key,
            track_id:
              violation.track_id,
            missing_ppe:
              violation.missing_ppe,
            start_time: timestamp,
            end_time: timestamp,
            last_seen: timestamp,
            confidence:
              violation.confidence,
          }
        );
      }
    );

    for (
      const [key, active]
      of activeEventsRef.current.entries()
    ) {
      if (
        !currentKeys.has(key)
        && timestamp
          - active.last_seen
          > EVENT_GAP_SECONDS
      ) {
        completeActiveEvent(active);

        activeEventsRef.current.delete(
          key
        );
      }
    }

    const duration =
      videoDurationRef.current;

    if (duration > 0) {
      setVideoProgress(
        Math.min(
          100,
          Math.round(
            (timestamp / duration)
            * 100
          )
        )
      );
    }
  }

  function finishVideoAnalysis() {
    if (!analysisActiveRef.current) {
      return;
    }

    analysisActiveRef.current = false;
    busyRef.current = false;
    pendingSeekRef.current = false;

    runIdRef.current += 1;

    for (
      const active
      of activeEventsRef.current.values()
    ) {
      completeActiveEvent(active);
    }

    activeEventsRef.current.clear();

    const events = [
      ...completedEventsRef.current,
    ].sort(
      (a, b) =>
        a.start_time - b.start_time
    );

    setVideoSummary({
      duration:
        videoDurationRef.current,
      people_tracked:
        trackedPeopleRef.current.size,
      events,
    });

    setVideoProgress(100);
    setDetecting(false);
  }


  function sourceDimensions(
    source:
      | HTMLImageElement
      | HTMLVideoElement
  ) {
    if (
      source instanceof HTMLImageElement
    ) {
      return {
        width: source.naturalWidth,
        height: source.naturalHeight,
      };
    }

    return {
      width: source.videoWidth,
      height: source.videoHeight,
    };
  }


  async function analyzeSource(
    source:
      | HTMLImageElement
      | HTMLVideoElement,
    timestamp: number,
    runId: number
  ) {
    if (
      !analysisActiveRef.current
      || runIdRef.current !== runId
      || busyRef.current
    ) {
      return;
    }

    const {
      width,
      height,
    } = sourceDimensions(source);

    if (width <= 0 || height <= 0) {
      setError(
        "Could not read the media dimensions."
      );

      cancelDetection();
      return;
    }

    busyRef.current = true;
    pendingTimestampRef.current =
      timestamp;

    try {
      const rawDetections =
        await ppeDetector.detect(
          source,
          width,
          height,
          0.35,
          0.45
        );

      let inferredGloveDetections:
        PPEDetection[] = [];

      try {
        inferredGloveDetections =
          await gloveInference
            .inferNoGloves(
              source,
              width,
              height,
              rawDetections,
              mediaType === "video"
                ? "video"
                : "image",
              timestamp * 1000
            );
      } catch (gloveError) {
        /*
         * Keep the trained PPE detector working
         * even if hand-landmark inference is
         * unavailable.
         */
        console.warn(
          "[SafeVision] NO-Gloves inference unavailable:",
          gloveError
        );
      }

      const allDetections =
        [
          ...rawDetections,
          ...inferredGloveDetections,
        ];

      if (
        !analysisActiveRef.current
        || runIdRef.current !== runId
      ) {
        return;
      }

      const frameIndex =
        mediaType === "video"
          ? videoFrameIndexRef.current++
          : 0;

      const data =
        buildDetectionResult(
          allDetections,
          width,
          height,
          frameIndex
        );

      setResult(data);
      drawResults(data);

      if (mediaType === "image") {
        analysisActiveRef.current =
          false;

        setDetecting(false);
        return;
      }

      if (mediaType === "video") {
        processVideoFrame(
          data,
          timestamp
        );

        const nextTimestamp =
          timestamp
          + VIDEO_SAMPLE_SECONDS;

        busyRef.current = false;

        if (
          nextTimestamp
          < videoDurationRef.current
        ) {
          queueVideoFrame(
            nextTimestamp
          );
        } else {
          finishVideoAnalysis();
        }
      }
    } catch (caughtError) {
      const message =
        caughtError
          instanceof Error
          ? caughtError.message
          : "Unknown browser inference error.";

      setError(
        `Browser PPE detection failed: ${message}`
      );

      cancelDetection();
    } finally {
      if (
        runIdRef.current === runId
      ) {
        busyRef.current = false;
      }
    }
  }


  function queueVideoFrame(
    timestamp: number
  ) {
    const video = videoRef.current;

    if (
      !video
      || !analysisActiveRef.current
    ) {
      return;
    }

    const duration =
      videoDurationRef.current;

    if (
      !Number.isFinite(duration)
      || duration <= 0
    ) {
      setError(
        "Could not determine the uploaded video duration."
      );

      cancelDetection();
      return;
    }

    if (
      timestamp >= duration
      && timestamp > 0
    ) {
      finishVideoAnalysis();
      return;
    }

    const target = Math.min(
      timestamp,
      Math.max(
        0,
        duration - 0.01
      )
    );

    pendingTimestampRef.current = target;

    if (
      Math.abs(
        video.currentTime - target
      ) < 0.025
      && video.readyState >= 2
    ) {
      pendingSeekRef.current = false;

      void analyzeSource(
        video,
        target,
        runIdRef.current
      );

      return;
    }

    pendingSeekRef.current = true;
    video.currentTime = target;
  }


  async function startDetection() {
    if (!file || !mediaType) {
      setError(
        "Select an image or video first."
      );
      return;
    }

    cancelDetection();
    clearOverlay();
    resetVideoAccumulator();

    setError("");
    setResult(null);

    const runId =
      runIdRef.current + 1;

    runIdRef.current = runId;

    analysisActiveRef.current = true;
    setDetecting(true);

    try {
      await ppeDetector.load();

      try {
        await gloveInference
          .startSession(
            mediaType
          );
      } catch (gloveError) {
        console.warn(
          "[SafeVision] Hand landmark model could not be prepared. Core PPE detection will continue:",
          gloveError
        );
      }

      if (
        !analysisActiveRef.current
        || runIdRef.current !== runId
      ) {
        return;
      }

      if (
        mediaType === "image"
        && imageRef.current
      ) {
        await analyzeSource(
          imageRef.current,
          0,
          runId
        );

        return;
      }

      if (
        mediaType === "video"
        && videoRef.current
      ) {
        const duration =
          videoRef.current.duration;

        if (
          !Number.isFinite(duration)
          || duration <= 0
        ) {
          setError(
            "Could not read the uploaded video duration."
          );

          cancelDetection();
          return;
        }

        videoRef.current.pause();

        videoDurationRef.current =
          duration;

        queueVideoFrame(0);
      }
    } catch (caughtError) {
      const message =
        caughtError
          instanceof Error
          ? caughtError.message
          : "Unknown model loading error.";

      setError(
        `Could not load the browser PPE model: ${message}`
      );

      cancelDetection();
    }
  }


  function handleImageLoad() {
    const image = imageRef.current;

    if (
      image
      && image.naturalWidth
      && image.naturalHeight
    ) {
      setAspectRatio(
        `${image.naturalWidth} / ${image.naturalHeight}`
      );
    }
  }


  function handleVideoMetadata() {
    const video = videoRef.current;

    if (
      video
      && video.videoWidth
      && video.videoHeight
    ) {
      setAspectRatio(
        `${video.videoWidth} / ${video.videoHeight}`
      );
    }
  }


  function handleVideoSeeked() {
    if (
      mediaType !== "video"
      || !analysisActiveRef.current
      || !pendingSeekRef.current
      || !videoRef.current
    ) {
      return;
    }

    pendingSeekRef.current = false;

    void analyzeSource(
      videoRef.current,
      pendingTimestampRef.current,
      runIdRef.current
    );
  }


  useEffect(() => {
    return () => {
      analysisActiveRef.current =
        false;

      runIdRef.current += 1;

      if (objectUrlRef.current) {
        URL.revokeObjectURL(
          objectUrlRef.current
        );
      }
    };
  }, []);


  const imageViolations =
    result?.violations ?? [];

  const positivePpeDetections =
    result?.detections.filter(
      detection =>
        positivePpeLabel(
          detection.class_name
        ) !== null
    ).length ?? 0;

  const videoEvents =
    videoSummary?.events ?? [];

  const hardhatEvents =
    videoEvents.filter(
      event =>
        event.missing_ppe === "hardhat"
    ).length;

  const vestEvents =
    videoEvents.filter(
      event =>
        event.missing_ppe === "vest"
    ).length;

  const maskEvents =
    videoEvents.filter(
      event =>
        event.missing_ppe === "mask"
    ).length;

  const glovesEvents =
    videoEvents.filter(
      event =>
        event.missing_ppe === "gloves"
    ).length;


  return (
    <section className="upload-page">
      <div className="upload-heading">
        <div>
          <h1>Upload detection</h1>

          <p>
            Analyze an image or full video for
            missing PPE without creating SafeVision
            incidents.
          </p>
        </div>

        <div
          className={
            detecting
              ? "upload-status active"
              : "upload-status"
          }
        >
          {detecting
            ? "Analyzing"
            : "Ready"}
        </div>
      </div>


      {error && (
        <div className="upload-error">
          {error}
        </div>
      )}


      <section className="upload-picker">
        <label className="upload-dropzone">
          <span className="upload-dropzone-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" />
              <path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
            </svg>
          </span>

          <strong>
            Choose an image or video
          </strong>

          <span>
            JPG, PNG, WEBP, MP4, MOV, WEBM
          </span>

          <input
            type="file"
            accept="image/*,video/*"
            onChange={handleFile}
          />
        </label>

        {file && (
          <div className="selected-file">
            <strong>{file.name}</strong>

            <span>
              {(
                file.size /
                1024 /
                1024
              ).toFixed(2)}
              {" MB"}
            </span>
          </div>
        )}
      </section>


      {mediaType && (
        <>
          <section
            className="upload-stage"
            style={{
              aspectRatio,
            }}
          >
            {mediaType === "image" && (
              <img
                ref={imageRef}
                src={mediaUrl}
                onLoad={handleImageLoad}
                alt="Uploaded"
                className="upload-media"
              />
            )}

            {mediaType === "video" && (
              <video
                ref={videoRef}
                src={mediaUrl}
                onLoadedMetadata={
                  handleVideoMetadata
                }
                onSeeked={handleVideoSeeked}
                controls={!detecting}
                muted
                playsInline
                className="upload-media"
              />
            )}

            <canvas
              ref={overlayRef}
              className="upload-overlay"
            />
          </section>


          <div className="upload-actions">
            <button
              onClick={startDetection}
              disabled={detecting}
            >
              {detecting
                ? "Analyzing…"
                : mediaType === "video"
                  ? "Analyze full video"
                  : "Run detection"}
            </button>

            {detecting && (
              <button
                onClick={() => {
                  if (mediaType === "video") {
                    finishVideoAnalysis();
                  } else {
                    cancelDetection();
                  }
                }}
              >
                {mediaType === "video"
                  ? "Finish partial report"
                  : "Stop"}
              </button>
            )}
          </div>


          {mediaType === "video"
            && detecting
            && (
              <section className="upload-progress-panel">
                <div className="upload-progress-header">
                  <div>
                    <strong>
                      Analyzing full video
                    </strong>

                    <span>
                      Sampling the video every 0.5 seconds
                      and combining repeated faults into
                      violation events.
                    </span>
                  </div>

                  <strong>
                    {videoProgress}%
                  </strong>
                </div>

                <div className="upload-progress-track">
                  <span
                    style={{
                      width:
                        `${videoProgress}%`,
                    }}
                  />
                </div>
              </section>
            )}
        </>
      )}


      {mediaType === "image"
        && result
        && (
          <section className="upload-results">
            <div className="upload-results-header">
              <div>
                <p className="upload-results-eyebrow">
                  Image check
                </p>

                <h2>Detection results</h2>
              </div>

              <span
                className={
                  imageViolations.length > 0
                    ? "upload-result-status danger"
                    : "upload-result-status clear"
                }
              >
                {imageViolations.length > 0
                  ? "PPE faults found"
                  : "No explicit faults"}
              </span>
            </div>


            <div className="upload-result-cards">
              <article>
                <span>
                  People detected
                </span>

                <strong>
                  {result.people.length}
                </strong>
              </article>

              <article
                className={
                  imageViolations.length > 0
                    ? "result-card-danger"
                    : "result-card-success"
                }
              >
                <span>
                  PPE faults
                </span>

                <strong>
                  {imageViolations.length}
                </strong>
              </article>
            </div>


            <h3 className="upload-subheading">
              Missing PPE
            </h3>

            <div className="upload-detection-list">
              {imageViolations.length === 0 ? (
                <div className="upload-empty-result">
                  <strong>
                    No explicit missing-PPE detections
                  </strong>

                  <span>
                    No explicit hardhat, vest, or mask fault
                    and no inferred visible bare-hand glove fault
                    was found in this image.
                  </span>
                </div>
              ) : (
                imageViolations.map(
                  (violation, index) => (
                    <div
                      className="upload-detection-row violation-row"
                      key={
                        `${violation.violation_type}-${violation.track_id}-${index}`
                      }
                    >
                      <div className="violation-row-main">
                        <span className="violation-icon">
                          !
                        </span>

                        <div>
                          <strong>
                            Missing {formatPpe(
                              violation.missing_ppe
                            )}
                          </strong>

                          <span>
                            {violation.track_id !== null
                              ? `Person #${violation.track_id}`
                              : "Worker not reliably tracked"}
                          </span>
                        </div>
                      </div>

                      <strong className="violation-confidence">
                        {violation.missing_ppe === "gloves"
                          ? "Inferred"
                          : `${Math.round(
                              violation.confidence * 100
                            )}%`}
                      </strong>
                    </div>
                  )
                )
              )}
            </div>


            <p className="analysis-note">
              Only violating workers and their explicit PPE faults are drawn on the image.
              {" "}{positivePpeDetections} positive PPE
              detection{positivePpeDetections === 1 ? " was" : "s were"}
              {" "}recognized but intentionally hidden from
              the overlay so attention stays on violations.
              Upload analysis runs locally in this browser
              and does not create incidents or modify dashboard
              analytics.
            </p>
          </section>
        )}


      {mediaType === "video"
        && videoSummary
        && (
          <section className="upload-results video-report">
            <div className="upload-results-header">
              <div>
                <p className="upload-results-eyebrow">
                  Video report
                </p>

                <h2>Analysis complete</h2>

                <p className="upload-results-description">
                  Browser-side tracking combines repeated
                  detections from the same worker into one
                  continuous violation event.
                </p>
              </div>

              <span
                className={
                  videoEvents.length > 0
                    ? "upload-result-status danger"
                    : "upload-result-status clear"
                }
              >
                {videoEvents.length > 0
                  ? `${videoEvents.length} faults`
                  : "No explicit faults"}
              </span>
            </div>


            <div className="upload-result-cards video-summary-cards">
              <article>
                <span>
                  Video duration
                </span>

                <strong>
                  {formatTimestamp(
                    videoSummary.duration
                  )}
                </strong>
              </article>

              <article>
                <span>
                  People tracked
                </span>

                <strong>
                  {videoSummary.people_tracked}
                </strong>
              </article>

              <article className="result-card-danger">
                <span>
                  Violation events
                </span>

                <strong>
                  {videoEvents.length}
                </strong>
              </article>

              <article>
                <span>
                  Hardhat
                </span>

                <strong>
                  {hardhatEvents}
                </strong>
              </article>

              <article>
                <span>
                  Vest
                </span>

                <strong>
                  {vestEvents}
                </strong>
              </article>

              <article>
                <span>
                  Mask
                </span>

                <strong>
                  {maskEvents}
                </strong>
              </article>

              <article>
                <span>
                  Gloves
                </span>

                <strong>
                  {glovesEvents}
                </strong>
              </article>
            </div>


            <div className="timeline-heading-row">
              <div>
                <h3 className="upload-subheading">
                  Violation timeline
                </h3>

                <p>
                  Timestamped PPE faults across the uploaded
                  video.
                </p>
              </div>

              <span>
                {videoEvents.length}
                {" events"}
              </span>
            </div>


            <div className="violation-timeline">
              {videoEvents.length === 0 ? (
                <div className="upload-empty-result">
                  <strong>
                    No explicit missing-PPE events found
                  </strong>

                  <span>
                    The analyzed samples did not contain an
                    explicit hardhat, vest, or mask fault or a
                    confirmed inferred visible bare-hand glove
                    fault.
                  </span>
                </div>
              ) : (
                videoEvents.map(
                  event => (
                    <div
                      className="timeline-row"
                      key={event.id}
                    >
                      <div className="timeline-time">
                        {formatEventTime(event)}
                      </div>

                      <div className="timeline-marker">
                        <span />
                      </div>

                      <div className="timeline-content">
                        <strong>
                          Missing {formatPpe(
                            event.missing_ppe
                          )}
                          {event.missing_ppe === "gloves"
                            ? " (inferred)"
                            : ""}
                        </strong>

                        <span>
                          {event.track_id !== null
                            ? `Person #${event.track_id}`
                            : "Worker not reliably tracked"}
                        </span>
                      </div>

                      <div className="timeline-confidence">
                        {event.missing_ppe === "gloves"
                          ? "Inferred"
                          : `${Math.round(
                              event.confidence * 100
                            )}%`}
                      </div>
                    </div>
                  )
                )
              )}
            </div>


            <p className="analysis-note">
              The video is sampled every 0.5 seconds in the
              browser. A lightweight IoU tracker keeps worker
              IDs reasonably stable across sampled frames, and
              repeated faults are merged into continuous events.
              Upload analysis remains separate from the
              PostgreSQL incident database. Missing gloves use
              browser-side hand landmarks plus the existing
              positive Gloves class, exposed-skin evidence, and
              two consecutive sampled video frames before
              becoming a timeline event.
            </p>
          </section>
        )}
    </section>
  );
}
