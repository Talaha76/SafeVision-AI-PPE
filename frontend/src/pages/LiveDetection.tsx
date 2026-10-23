// ============================================================
// SAFEVISION AI — LIVE DETECTION
// ============================================================
//
// Runs browser-based PPE detection from the webcam, tracks
// people, confirms violations, draws overlays, and sends
// confirmed incidents with evidence to the backend.
//
// ============================================================

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ppeDetector,
  type PPEDetection as BrowserPPEDetection,
} from "../services/ppeDetector";

import {
  gloveInference,
} from "../services/gloveInference";

import "./LiveDetection.css";


type Box = [
  number,
  number,
  number,
  number,
];


type PersonDetection = {
  track_id: number;
  confidence: number;
  box: Box;
};


type DisplayPPEDetection = {
  class_name: string;
  normalized_class_name: string;
  confidence: number;
  box: Box;
};


type DetectionResult = {
  frame_width: number;
  frame_height: number;
  people: PersonDetection[];
  detections: DisplayPPEDetection[];
};


type BrowserTrack = {
  id: number;
  box: Box;
  confidence: number;
  missedFrames: number;
};


type MissingPpe =
  | "hardhat"
  | "vest"
  | "mask"
  | "gloves";


type FrameViolation = {
  key: string;
  trackId: number;
  missingPpe: MissingPpe;
  confidence: number;
  personBox: Box;
};


type RecentIncidentRegion = {
  box: Box;
  timestamp: number;
};


const CONFIDENCE_THRESHOLD =
  0.35;

const NMS_IOU_THRESHOLD =
  0.45;

const DETECTION_INTERVAL_MS =
  450;


const TRACK_IOU_THRESHOLD =
  0.12;

const MAX_MISSED_FRAMES =
  10;

const TRACK_CENTER_DISTANCE_THRESHOLD =
  0.35;

const TRACK_MIN_AREA_RATIO =
  0.50;


const INCIDENT_CONFIRM_FRAMES =
  3;

const INCIDENT_CLEAR_FRAMES =
  4;

const INCIDENT_COOLDOWN_MS =
  60_000;

const REGION_COOLDOWN_MS =
  90_000;


/*
 * Evidence is resized before upload.
 *
 * This keeps the evidence useful while
 * avoiding unnecessarily large database
 * records and network requests.
 */
const EVIDENCE_MAX_WIDTH =
  960;

const EVIDENCE_JPEG_QUALITY =
  0.72;


const DISPLAY_PPE_CLASSES =
  new Set([
    "no_hardhat",
    "no_vest",
    "no_mask",
    "no_gloves",
  ]);


function calculateIoU(
  a: Box,
  b: Box,
): number {
  const x1 =
    Math.max(
      a[0],
      b[0],
    );

  const y1 =
    Math.max(
      a[1],
      b[1],
    );

  const x2 =
    Math.min(
      a[2],
      b[2],
    );

  const y2 =
    Math.min(
      a[3],
      b[3],
    );


  const intersectionWidth =
    Math.max(
      0,
      x2 - x1,
    );

  const intersectionHeight =
    Math.max(
      0,
      y2 - y1,
    );

  const intersectionArea =
    intersectionWidth
    * intersectionHeight;


  const areaA =
    Math.max(
      0,
      a[2] - a[0],
    )
    *
    Math.max(
      0,
      a[3] - a[1],
    );


  const areaB =
    Math.max(
      0,
      b[2] - b[0],
    )
    *
    Math.max(
      0,
      b[3] - b[1],
    );


  const union =
    areaA
    + areaB
    - intersectionArea;


  if (union <= 0) {
    return 0;
  }


  return (
    intersectionArea
    / union
  );
}


function normalizedCenterDistance(
  a: Box,
  b: Box,
): number {
  const aCenterX = (a[0] + a[2]) / 2;
  const aCenterY = (a[1] + a[3]) / 2;
  const bCenterX = (b[0] + b[2]) / 2;
  const bCenterY = (b[1] + b[3]) / 2;

  const normalizerX = Math.max(
    1,
    (a[2] - a[0] + b[2] - b[0]) / 2,
  );

  const normalizerY = Math.max(
    1,
    (a[3] - a[1] + b[3] - b[1]) / 2,
  );

  const dx = (aCenterX - bCenterX) / normalizerX;
  const dy = (aCenterY - bCenterY) / normalizerY;

  return Math.sqrt(dx * dx + dy * dy);
}


function areaRatio(
  a: Box,
  b: Box,
): number {
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);

  if (areaA <= 0 || areaB <= 0) {
    return 0;
  }

  return Math.min(areaA, areaB) / Math.max(areaA, areaB);
}


function boxesLikelySamePerson(
  a: Box,
  b: Box,
): boolean {
  if (calculateIoU(a, b) >= 0.20) {
    return true;
  }

  return (
    normalizedCenterDistance(a, b) <= TRACK_CENTER_DISTANCE_THRESHOLD
    && areaRatio(a, b) >= TRACK_MIN_AREA_RATIO
  );
}


function smoothBox(
  previous: Box,
  current: Box,
): Box {
  const previousWeight =
    0.35;

  const currentWeight =
    0.65;


  return [
    previous[0]
      * previousWeight
      + current[0]
      * currentWeight,

    previous[1]
      * previousWeight
      + current[1]
      * currentWeight,

    previous[2]
      * previousWeight
      + current[2]
      * currentWeight,

    previous[3]
      * previousWeight
      + current[3]
      * currentWeight,
  ];
}


function missingPpeFromClass(
  className: string,
): MissingPpe | null {
  switch (className) {
    case "no_hardhat":
      return "hardhat";

    case "no_vest":
      return "vest";

    case "no_mask":
      return "mask";

    case "no_gloves":
      return "gloves";

    default:
      return null;
  }
}


function findPersonForViolation(
  violation:
    BrowserPPEDetection,

  people:
    PersonDetection[],
): PersonDetection | null {
  const [
    x1,
    y1,
    x2,
    y2,
  ] =
    violation.xyxy;


  const centerX =
    (x1 + x2) / 2;

  const centerY =
    (y1 + y2) / 2;


  let bestPerson:
    PersonDetection | null =
    null;

  let smallestArea =
    Number
      .POSITIVE_INFINITY;


  for (
    const person
    of people
  ) {
    const [
      px1,
      py1,
      px2,
      py2,
    ] =
      person.box;


    const containsCenter =
      centerX >= px1
      && centerX <= px2
      && centerY >= py1
      && centerY <= py2;


    if (!containsCenter) {
      continue;
    }


    const area =
      Math.max(
        0,
        px2 - px1,
      )
      *
      Math.max(
        0,
        py2 - py1,
      );


    if (
      area
      < smallestArea
    ) {
      smallestArea =
        area;

      bestPerson =
        person;
    }
  }


  return bestPerson;
}


export default function LiveDetection() {
  const videoRef =
    useRef<
      HTMLVideoElement | null
    >(null);


  const overlayRef =
    useRef<
      HTMLCanvasElement | null
    >(null);


  const streamRef =
    useRef<
      MediaStream | null
    >(null);


  const timerRef =
    useRef<
      number | null
    >(null);


  const busyRef =
    useRef(false);


  const detectionActiveRef =
    useRef(false);


  const tracksRef =
    useRef<
      Map<
        number,
        BrowserTrack
      >
    >(
      new Map(),
    );


  const nextTrackIdRef =
    useRef(1);


  const violationStreaksRef =
    useRef<
      Map<
        string,
        number
      >
    >(
      new Map(),
    );


  const incidentCooldownRef =
    useRef<
      Map<
        string,
        number
      >
    >(
      new Map(),
    );


  const incidentInFlightRef =
    useRef<
      Set<string>
    >(
      new Set(),
    );


  const incidentLatchedRef =
    useRef<
      Set<string>
    >(
      new Set(),
    );


  const inactiveViolationFramesRef =
    useRef<
      Map<string, number>
    >(
      new Map(),
    );


  const recentIncidentRegionsRef =
    useRef<
      Map<
        MissingPpe,
        RecentIncidentRegion[]
      >
    >(
      new Map(),
    );


  const [
    cameraOn,
    setCameraOn,
  ] =
    useState(false);


  const [
    detecting,
    setDetecting,
  ] =
    useState(false);


  const [
    error,
    setError,
  ] =
    useState("");


  const [
    peopleCount,
    setPeopleCount,
  ] =
    useState(0);


  const [
    detectionCount,
    setDetectionCount,
  ] =
    useState(0);


  function clearOverlay() {
    const canvas =
      overlayRef.current;


    if (!canvas) {
      return;
    }


    const ctx =
      canvas.getContext(
        "2d",
      );


    if (!ctx) {
      return;
    }


    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }


  function resetTracking() {
    tracksRef
      .current
      .clear();


    nextTrackIdRef.current =
      1;


    violationStreaksRef
      .current
      .clear();


    incidentInFlightRef
      .current
      .clear();


    incidentLatchedRef
      .current
      .clear();


    inactiveViolationFramesRef
      .current
      .clear();


    recentIncidentRegionsRef
      .current
      .clear();


    incidentCooldownRef
      .current
      .clear();


    setPeopleCount(0);

    setDetectionCount(0);
  }


  async function startCamera() {
    try {
      setError("");


      if (
        !navigator.mediaDevices
        ||
        !navigator.mediaDevices
          .getUserMedia
      ) {
        throw new Error(
          "Camera access is not supported by this browser.",
        );
      }


      const stream =
        await navigator
          .mediaDevices
          .getUserMedia({
            video: {
              width: {
                ideal: 1280,
              },

              height: {
                ideal: 720,
              },

              facingMode:
                "user",
            },

            audio: false,
          });


      streamRef.current =
        stream;


      const video =
        videoRef.current;


      if (video) {
        video.srcObject =
          stream;

        await video.play();
      }


      setCameraOn(true);
    } catch (err) {
      console.error(
        "[SafeVision] Camera error:",
        err,
      );


      setError(
        "Could not access the camera. Check browser camera permissions.",
      );
    }
  }


  function stopCamera() {
    stopDetection();


    streamRef.current
      ?.getTracks()
      .forEach(
        track =>
          track.stop(),
      );


    streamRef.current =
      null;


    if (
      videoRef.current
    ) {
      videoRef.current
        .srcObject =
        null;
    }


    clearOverlay();

    resetTracking();

    setCameraOn(false);
  }


  function updatePersonTracks(
    personDetections:
      BrowserPPEDetection[],
  ): PersonDetection[] {
    const existingTracks =
      Array.from(
        tracksRef.current.values(),
      );

    const usedTrackIds =
      new Set<number>();

    const currentTrackIds =
      new Set<number>();

    const sortedDetections =
      [...personDetections].sort(
        (a, b) =>
          b.confidence - a.confidence,
      );

    const output:
      PersonDetection[] = [];

    for (const detection of sortedDetections) {
      let bestTrack:
        BrowserTrack | null = null;

      let bestScore =
        Number.NEGATIVE_INFINITY;

      for (const track of existingTracks) {
        if (usedTrackIds.has(track.id)) {
          continue;
        }

        const overlap =
          calculateIoU(
            track.box,
            detection.xyxy,
          );

        const centerDistance =
          normalizedCenterDistance(
            track.box,
            detection.xyxy,
          );

        const sizeSimilarity =
          areaRatio(
            track.box,
            detection.xyxy,
          );

        const plausibleMatch =
          overlap >= TRACK_IOU_THRESHOLD
          || (
            centerDistance <= TRACK_CENTER_DISTANCE_THRESHOLD
            && sizeSimilarity >= TRACK_MIN_AREA_RATIO
          );

        if (!plausibleMatch) {
          continue;
        }

        const score =
          overlap * 2
          + Math.max(0, 1 - centerDistance) * 0.5
          + sizeSimilarity * 0.25;

        if (score > bestScore) {
          bestScore = score;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        const updatedBox =
          smoothBox(
            bestTrack.box,
            detection.xyxy,
          );

        const updatedTrack:
          BrowserTrack = {
            id: bestTrack.id,
            box: updatedBox,
            confidence: detection.confidence,
            missedFrames: 0,
          };

        tracksRef.current.set(
          updatedTrack.id,
          updatedTrack,
        );

        usedTrackIds.add(updatedTrack.id);
        currentTrackIds.add(updatedTrack.id);

        output.push({
          track_id: updatedTrack.id,
          confidence: updatedTrack.confidence,
          box: updatedTrack.box,
        });

        continue;
      }

      const newTrackId =
        nextTrackIdRef.current++;

      const newTrack:
        BrowserTrack = {
          id: newTrackId,
          box: detection.xyxy,
          confidence: detection.confidence,
          missedFrames: 0,
        };

      tracksRef.current.set(
        newTrackId,
        newTrack,
      );

      usedTrackIds.add(newTrackId);
      currentTrackIds.add(newTrackId);

      output.push({
        track_id: newTrackId,
        confidence: detection.confidence,
        box: detection.xyxy,
      });
    }

    for (const track of Array.from(tracksRef.current.values())) {
      if (currentTrackIds.has(track.id)) {
        continue;
      }

      const missedFrames =
        track.missedFrames + 1;

      if (missedFrames > MAX_MISSED_FRAMES) {
        tracksRef.current.delete(track.id);
        continue;
      }

      tracksRef.current.set(
        track.id,
        {
          ...track,
          missedFrames,
        },
      );
    }

    return output.sort(
      (a, b) => a.track_id - b.track_id,
    );
  }

  function drawLabel(
    ctx:
      CanvasRenderingContext2D,

    text:
      string,

    x:
      number,

    y:
      number,

    color:
      string,
  ) {
    ctx.font =
      "600 16px Arial";


    const paddingX =
      6;

    const paddingY =
      4;


    const metrics =
      ctx.measureText(
        text,
      );


    const textHeight =
      18;


    const backgroundWidth =
      metrics.width
      + paddingX * 2;


    const backgroundHeight =
      textHeight
      + paddingY * 2;


    const labelX =
      Math.max(
        0,
        Math.min(
          x,
          ctx.canvas.width
          - backgroundWidth,
        ),
      );


    const labelY =
      Math.max(
        backgroundHeight,
        y,
      );


    ctx.fillStyle =
      color;


    ctx.fillRect(
      labelX,
      labelY
      - backgroundHeight,
      backgroundWidth,
      backgroundHeight,
    );


    ctx.fillStyle =
      "#ffffff";


    ctx.fillText(
      text,
      labelX
      + paddingX,
      labelY
      - paddingY
      - 2,
    );
  }


  function drawResults(
    result:
      DetectionResult,
  ) {
    const canvas =
      overlayRef.current;


    if (!canvas) {
      return;
    }


    canvas.width =
      result.frame_width;

    canvas.height =
      result.frame_height;


    const ctx =
      canvas.getContext(
        "2d",
      );


    if (!ctx) {
      return;
    }


    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );


    ctx.lineWidth =
      Math.max(
        2,
        Math.round(
          canvas.width
          / 450,
        ),
      );


    result.people.forEach(
      person => {
        const [
          x1,
          y1,
          x2,
          y2,
        ] =
          person.box;


        ctx.strokeStyle =
          "#3b82f6";


        ctx.strokeRect(
          x1,
          y1,
          x2 - x1,
          y2 - y1,
        );


        drawLabel(
          ctx,
          `Person #${person.track_id}`,
          x1,
          y1,
          "#2563eb",
        );
      },
    );


    result.detections.forEach(
      detection => {
        const [
          x1,
          y1,
          x2,
          y2,
        ] =
          detection.box;


        const color =
          "#ef4444";


        ctx.strokeStyle =
          color;


        ctx.strokeRect(
          x1,
          y1,
          x2 - x1,
          y2 - y1,
        );


        const label =
          detection.normalized_class_name
            === "no_gloves"
            ? "NO-Gloves (inferred)"
            : `${
                detection.class_name
              } ${
                Math.round(
                  detection.confidence * 100,
                )
              }%`;


        drawLabel(
          ctx,
          label,
          x1,
          y1,
          color,
        );
      },
    );


    setPeopleCount(
      result.people.length,
    );


    setDetectionCount(
      result
        .detections
        .length,
    );
  }


  function captureEvidenceImage():
    string | null {
    const video =
      videoRef.current;


    const overlay =
      overlayRef.current;


    if (
      !video
      ||
      !overlay
      ||
      video.videoWidth <= 0
      ||
      video.videoHeight <= 0
    ) {
      return null;
    }


    const scale =
      Math.min(
        1,
        EVIDENCE_MAX_WIDTH
        / video.videoWidth,
      );


    const width =
      Math.max(
        1,
        Math.round(
          video.videoWidth
          * scale,
        ),
      );


    const height =
      Math.max(
        1,
        Math.round(
          video.videoHeight
          * scale,
        ),
      );


    const canvas =
      document.createElement(
        "canvas",
      );


    canvas.width =
      width;

    canvas.height =
      height;


    const ctx =
      canvas.getContext(
        "2d",
      );


    if (!ctx) {
      return null;
    }


    /*
     * First draw the real camera frame.
     */
    ctx.drawImage(
      video,
      0,
      0,
      width,
      height,
    );


    /*
     * Then draw SafeVision's current
     * annotated overlay on top.
     */
    if (
      overlay.width > 0
      &&
      overlay.height > 0
    ) {
      ctx.drawImage(
        overlay,
        0,
        0,
        overlay.width,
        overlay.height,
        0,
        0,
        width,
        height,
      );
    }


    return canvas.toDataURL(
      "image/jpeg",
      EVIDENCE_JPEG_QUALITY,
    );
  }


  async function postBrowserIncident(
    trackId: number,
    missingPpe:
      MissingPpe,
    confidence: number,
    personBox: Box,
  ) {
    const key =
      `${trackId}:${missingPpe}`;


    if (
      incidentInFlightRef
        .current
        .has(key)
    ) {
      return;
    }


    const now =
      Date.now();


    const recentRegions =
      (
        recentIncidentRegionsRef
          .current
          .get(missingPpe)
        ?? []
      ).filter(
        region =>
          now - region.timestamp
          < REGION_COOLDOWN_MS,
      );


    recentIncidentRegionsRef
      .current
      .set(
        missingPpe,
        recentRegions,
      );


    if (
      recentRegions.some(
        region =>
          boxesLikelySamePerson(
            region.box,
            personBox,
          ),
      )
    ) {
      incidentCooldownRef
        .current
        .set(
          key,
          now,
        );

      return;
    }


    const previousIncident =
      incidentCooldownRef
        .current
        .get(key);


    if (
      previousIncident
        !== undefined
      &&
      now
      - previousIncident
        < INCIDENT_COOLDOWN_MS
    ) {
      return;
    }


    incidentInFlightRef
      .current
      .add(key);


    /*
     * Capture evidence only when a
     * confirmed incident is actually
     * about to be submitted.
     */
    const evidenceImage =
      captureEvidenceImage();


    try {
      const apiUrl =
        (
          import.meta.env
            .VITE_API_URL
          ??
          "http://127.0.0.1:8000/api"
        ).replace(
          /\/$/,
          "",
        );


      const response =
        await fetch(
          `${apiUrl}/browser-incidents`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                camera_id:
                  1,

                track_id:
                  trackId,

                missing_ppe:
                  missingPpe,

                confidence,

                evidence_image:
                  evidenceImage,
              }),
          },
        );


      if (
        !response.ok
      ) {
        const body =
          await response.text();


        throw new Error(
          `Incident API returned ${response.status}: ${body}`,
        );
      }


      const responseData =
        await response.json();


      const savedAt =
        Date.now();


      incidentCooldownRef
        .current
        .set(
          key,
          savedAt,
        );


      const regions =
        recentIncidentRegionsRef
          .current
          .get(missingPpe)
        ?? [];


      regions.push({
        box: [...personBox],
        timestamp: savedAt,
      });


      recentIncidentRegionsRef
        .current
        .set(
          missingPpe,
          regions.slice(-12),
        );


      console.log(
        "[SafeVision] Browser incident:",
        responseData,
      );
    } catch (err) {
      console.error(
        "[SafeVision] Incident could not be saved:",
        err,
      );
    } finally {
      incidentInFlightRef
        .current
        .delete(key);
    }
  }


  function processViolationsForIncidents(
    detections:
      BrowserPPEDetection[],

    people:
      PersonDetection[],
  ) {
    const frameViolations =
      new Map<
        string,
        FrameViolation
      >();


    for (
      const detection
      of detections
    ) {
      const missingPpe =
        missingPpeFromClass(
          detection
            .className,
        );


      if (!missingPpe) {
        continue;
      }


      const person =
        findPersonForViolation(
          detection,
          people,
        );


      if (!person) {
        continue;
      }


      const key =
        `${
          person.track_id
        }:${missingPpe}`;


      const existing =
        frameViolations
          .get(key);


      if (
        !existing
        ||
        detection
          .confidence
          >
          existing
            .confidence
      ) {
        frameViolations.set(
          key,
          {
            key,

            trackId:
              person.track_id,

            missingPpe,

            confidence:
              detection
                .confidence,

            personBox:
              person.box,
          },
        );
      }
    }


    const activeKeys =
      new Set(
        frameViolations
          .keys(),
      );


    for (
      const violation
      of frameViolations
        .values()
    ) {
      const currentStreak =
        (
          violationStreaksRef
            .current
            .get(
              violation.key,
            )
          ?? 0
        )
        + 1;


      violationStreaksRef
        .current
        .set(
          violation.key,
          currentStreak,
        );


      inactiveViolationFramesRef
        .current
        .set(
          violation.key,
          0,
        );


      if (
        currentStreak
        >= INCIDENT_CONFIRM_FRAMES
        && !incidentLatchedRef
          .current
          .has(violation.key)
      ) {
        incidentLatchedRef
          .current
          .add(violation.key);


        void postBrowserIncident(
          violation.trackId,
          violation.missingPpe,
          violation.confidence,
          violation.personBox,
        );
      }
    }


    const knownKeys =
      new Set<string>([
        ...violationStreaksRef
          .current
          .keys(),
        ...incidentLatchedRef
          .current
          .keys(),
      ]);


    for (const key of knownKeys) {
      if (activeKeys.has(key)) {
        continue;
      }


      const inactiveFrames =
        (
          inactiveViolationFramesRef
            .current
            .get(key)
          ?? 0
        )
        + 1;


      inactiveViolationFramesRef
        .current
        .set(
          key,
          inactiveFrames,
        );


      if (
        inactiveFrames
        < INCIDENT_CLEAR_FRAMES
      ) {
        continue;
      }


      violationStreaksRef
        .current
        .delete(key);


      incidentLatchedRef
        .current
        .delete(key);


      inactiveViolationFramesRef
        .current
        .delete(key);
    }
  }


  function scheduleNextFrame(
    elapsedMs = 0,
  ) {
    if (
      !detectionActiveRef
        .current
    ) {
      return;
    }


    const remainingDelay =
      Math.max(
        50,
        DETECTION_INTERVAL_MS
        - elapsedMs,
      );


    timerRef.current =
      window.setTimeout(
        () => {
          void processDetectionFrame();
        },
        remainingDelay,
      );
  }


  async function processDetectionFrame() {
    if (
      !detectionActiveRef
        .current
    ) {
      return;
    }


    if (
      busyRef.current
    ) {
      scheduleNextFrame();
      return;
    }


    const video =
      videoRef.current;


    if (
      !video
      ||
      video.videoWidth <= 0
      ||
      video.videoHeight <= 0
    ) {
      scheduleNextFrame();
      return;
    }


    busyRef.current =
      true;


    const frameStartedAt =
      performance.now();


    try {
      const detections =
        await ppeDetector.detect(
          video,
          video.videoWidth,
          video.videoHeight,
          CONFIDENCE_THRESHOLD,
          NMS_IOU_THRESHOLD,
        );


      let inferredGloveDetections:
        BrowserPPEDetection[] =
        [];


      try {
        inferredGloveDetections =
          await gloveInference
            .inferNoGloves(
              video,
              video.videoWidth,
              video.videoHeight,
              detections,
              "video",
              performance.now(),
            );
      } catch (gloveError) {
        /*
         * Glove inference is an enhancement.
         * If MediaPipe cannot load or run,
         * the trained PPE detector continues.
         */
        console.warn(
          "[SafeVision] NO-Gloves inference unavailable:",
          gloveError,
        );
      }


      const allDetections =
        [
          ...detections,
          ...inferredGloveDetections,
        ];


      if (
        !detectionActiveRef
          .current
      ) {
        return;
      }


      const personDetections =
        allDetections.filter(
          detection =>
            detection
              .className
            === "person",
        );


      const people =
        updatePersonTracks(
          personDetections,
        );


      const ppeDetections:
        DisplayPPEDetection[] =
        allDetections
          .filter(
            detection =>
              DISPLAY_PPE_CLASSES
                .has(
                  detection
                    .className,
                ),
          )
          .map(
            detection => ({
              class_name:
                detection
                  .rawClassName,

              normalized_class_name:
                detection
                  .className,

              confidence:
                detection
                  .confidence,

              box:
                detection
                  .xyxy,
            }),
          );


      /*
       * Draw first so the evidence capture
       * contains this exact inference
       * frame's boxes and labels.
       */
      drawResults({
        frame_width:
          video.videoWidth,

        frame_height:
          video.videoHeight,

        people,

        detections:
          ppeDetections,
      });


      /*
       * Then confirm and create incidents.
       */
      processViolationsForIncidents(
        allDetections,
        people,
      );


      setError("");
    } catch (err) {
      console.error(
        "[SafeVision] Live browser detection failed:",
        err,
      );


      const message =
        err instanceof Error
          ? err.message
          : (
              "Unknown browser "
              + "detection error."
            );


      setError(
        `Live detection failed: ${message}`,
      );
    } finally {
      busyRef.current =
        false;


      const elapsed =
        performance.now()
        - frameStartedAt;


      scheduleNextFrame(
        elapsed,
      );
    }
  }


  async function startDetection() {
    if (!cameraOn) {
      setError(
        "Start the camera before starting detection.",
      );

      return;
    }


    if (
      detectionActiveRef
        .current
    ) {
      return;
    }


    setError("");

    resetTracking();


    detectionActiveRef
      .current =
      true;


    setDetecting(true);


    try {
      await ppeDetector.load();


      try {
        await gloveInference
          .startSession(
            "video",
          );
      } catch (gloveError) {
        console.warn(
          "[SafeVision] Hand landmark model could not be prepared. Core PPE detection will continue:",
          gloveError,
        );
      }


      if (
        !detectionActiveRef
          .current
      ) {
        return;
      }


      void processDetectionFrame();
    } catch (err) {
      detectionActiveRef
        .current =
        false;


      setDetecting(false);


      console.error(
        "[SafeVision] Could not start live detection:",
        err,
      );


      const message =
        err instanceof Error
          ? err.message
          : (
              "Unknown model "
              + "loading error."
            );


      setError(
        `Could not start browser PPE detection: ${message}`,
      );
    }
  }


  function stopDetection() {
    detectionActiveRef
      .current =
      false;


    if (
      timerRef.current
        !== null
    ) {
      window.clearTimeout(
        timerRef.current,
      );

      timerRef.current =
        null;
    }


    busyRef.current =
      false;


    violationStreaksRef
      .current
      .clear();


    incidentInFlightRef
      .current
      .clear();


    incidentLatchedRef
      .current
      .clear();


    inactiveViolationFramesRef
      .current
      .clear();


    recentIncidentRegionsRef
      .current
      .clear();


    setDetecting(false);


    clearOverlay();


    setPeopleCount(0);

    setDetectionCount(0);
  }


  useEffect(() => {
    return () => {
      detectionActiveRef
        .current =
        false;


      if (
        timerRef.current
          !== null
      ) {
        window.clearTimeout(
          timerRef.current,
        );
      }


      streamRef.current
        ?.getTracks()
        .forEach(
          track =>
            track.stop(),
        );
    };
  }, []);


  return (
    <section className="live-page">
      <div className="live-heading">
        <div>
          <p className="live-eyebrow">
            REAL-TIME PPE MONITORING
          </p>

          <h1>
            Live Detection
          </h1>

          <p>
            Run SafeVision directly from your
            browser camera.
          </p>
        </div>

        <div
          className={
            detecting
              ? "live-status active"
              : "live-status"
          }
        >
          {detecting
            ? "● LIVE"
            : cameraOn
              ? "READY"
              : "OFFLINE"}
        </div>
      </div>


      {error && (
        <div className="live-error">
          {error}
        </div>
      )}


      <div className="camera-panel">
        <div className="camera-stage">
          <video
            ref={videoRef}
            muted
            playsInline
            className="live-video"
          />

          <canvas
            ref={overlayRef}
            className="live-overlay"
          />

          {!cameraOn && (
            <div className="camera-placeholder">
              Camera is off
            </div>
          )}
        </div>


        <div className="camera-controls">
          {!cameraOn ? (
            <button
              onClick={
                startCamera
              }
            >
              Start Camera
            </button>
          ) : (
            <button
              onClick={
                stopCamera
              }
            >
              Stop Camera
            </button>
          )}


          {!detecting ? (
            <button
              onClick={
                startDetection
              }
              disabled={
                !cameraOn
              }
            >
              Start Detection
            </button>
          ) : (
            <button
              onClick={
                stopDetection
              }
            >
              Stop Detection
            </button>
          )}
        </div>
      </div>


      <div className="live-stats">
        <div>
          <span>
            People tracked
          </span>

          <strong>
            {peopleCount}
          </strong>
        </div>

        <div>
          <span>
            PPE detections
          </span>

          <strong>
            {detectionCount}
          </strong>
        </div>

        <div>
          <span>
            Status
          </span>

          <strong>
            {detecting
              ? "Detecting"
              : cameraOn
                ? "Ready"
                : "Idle"}
          </strong>
        </div>
      </div>
    </section>
  );
}
