import {
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";

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


const VIDEO_SAMPLE_SECONDS = 0.5;
const EVENT_GAP_SECONDS = 1.25;


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


export default function UploadDetection() {
  const imageRef =
    useRef<HTMLImageElement | null>(null);

  const videoRef =
    useRef<HTMLVideoElement | null>(null);

  const overlayRef =
    useRef<HTMLCanvasElement | null>(null);

  const captureRef =
    useRef<HTMLCanvasElement | null>(null);

  const socketRef =
    useRef<WebSocket | null>(null);

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


  function closeSocket() {
    const socket = socketRef.current;

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }

    socketRef.current = null;
  }


  function resetVideoAccumulator() {
    trackedPeopleRef.current =
      new Set<number>();

    activeEventsRef.current =
      new Map<string, ActiveViolationEvent>();

    completedEventsRef.current = [];

    pendingTimestampRef.current = 0;
    pendingSeekRef.current = false;
    videoDurationRef.current = 0;

    setVideoProgress(0);
    setVideoSummary(null);
  }


  function cancelDetection() {
    analysisActiveRef.current = false;
    busyRef.current = false;
    pendingSeekRef.current = false;

    closeSocket();
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


    // ------------------------------------------------------
    // VIOLATION-FOCUSED OVERLAY
    //
    // Compliant PPE detections stay hidden.
    // Only workers with an explicit missing-PPE fault get
    // a person/track box, and each fault gets its own red
    // violation box with the confidence percentage.
    // ------------------------------------------------------

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


    // Draw one blue person / track box only for workers
    // who have at least one explicit PPE violation.
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


    // Draw every explicit missing-PPE detection in red.
    // The label keeps the confidence percentage visible.
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

        drawLabel(
          ctx,
          `Missing ${formatPpe(
            violation.missing_ppe
          )} ${Math.round(
            violation.confidence * 100
          )}%`,
          x1,
          y1,
          "#dc2626",
          fontSize
        );
      }
    );
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

    // Spatial buckets give unmatched detections a reasonably
    // stable identity across nearby sampled frames.
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

    const currentKeys =
      new Set<string>();

    data.violations.forEach(
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

    for (
      const active
      of activeEventsRef.current.values()
    ) {
      completeActiveEvent(active);
    }

    activeEventsRef.current.clear();

    const events = [
      ...completedEventsRef.current,
    ]
      .filter(
        event =>
          event.missing_ppe !== "gloves"
          || event.end_time - event.start_time
            >= VIDEO_SAMPLE_SECONDS * 0.9
      )
      .sort(
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

    closeSocket();
  }


  function sendCanvasFrame(
    source:
      | HTMLImageElement
      | HTMLVideoElement,
    timestamp = 0
  ) {
    const captureCanvas =
      captureRef.current;

    const socket =
      socketRef.current;

    if (
      !captureCanvas
      || !socket
      || socket.readyState
        !== WebSocket.OPEN
      || busyRef.current
      || !analysisActiveRef.current
    ) {
      return;
    }

    let width = 0;
    let height = 0;

    if (
      source instanceof HTMLImageElement
    ) {
      width = source.naturalWidth;
      height = source.naturalHeight;
    } else {
      width = source.videoWidth;
      height = source.videoHeight;
    }

    if (width === 0 || height === 0) {
      return;
    }

    busyRef.current = true;
    pendingTimestampRef.current =
      timestamp;

    captureCanvas.width = width;
    captureCanvas.height = height;

    const ctx =
      captureCanvas.getContext("2d");

    if (!ctx) {
      busyRef.current = false;
      return;
    }

    ctx.drawImage(
      source,
      0,
      0,
      width,
      height
    );

    captureCanvas.toBlob(
      async (blob) => {
        if (!blob) {
          busyRef.current = false;
          return;
        }

        try {
          const buffer =
            await blob.arrayBuffer();

          socket.send(buffer);
        } catch {
          busyRef.current = false;

          setError(
            "Could not send frame to the detection server."
          );
        }
      },
      "image/jpeg",
      0.82
    );
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

      sendCanvasFrame(
        video,
        target
      );

      return;
    }

    pendingSeekRef.current = true;
    video.currentTime = target;
  }


  function startDetection() {
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

    analysisActiveRef.current = true;

const apiUrl =
  import.meta.env.VITE_API_URL
  ?? "http://127.0.0.1:8000/api";

const wsUrl = apiUrl
  .replace(/^http/, "ws")
  .replace(/\/$/, "");

const socket = new WebSocket(
  `${wsUrl}/upload-detection/ws`
);

    socketRef.current = socket;


    socket.onopen = () => {
      setDetecting(true);

      if (
        mediaType === "image"
        && imageRef.current
      ) {
        sendCanvasFrame(
          imageRef.current,
          0
        );
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
    };


    socket.onmessage = (event) => {
      busyRef.current = false;

      try {
        const data:
          DetectionResult =
          JSON.parse(event.data);

        if (data.error) {
          setError(data.error);
          cancelDetection();
          return;
        }

        if (!data.violations) {
          data.violations = [];
        }

        setResult(data);
        drawResults(data);

        if (mediaType === "image") {
          analysisActiveRef.current = false;
          setDetecting(false);
          closeSocket();
          return;
        }

        if (mediaType === "video") {
          const timestamp =
            pendingTimestampRef.current;

          processVideoFrame(
            data,
            timestamp
          );

          const nextTimestamp =
            timestamp
            + VIDEO_SAMPLE_SECONDS;

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
      } catch {
        setError(
          "Could not read detection response."
        );

        cancelDetection();
      }
    };


    socket.onerror = () => {
      busyRef.current = false;

      setError(
        "Detection server connection failed."
      );

      cancelDetection();
    };


    socket.onclose = () => {
      busyRef.current = false;

      if (analysisActiveRef.current) {
        analysisActiveRef.current = false;
        setDetecting(false);
      }
    };
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

    sendCanvasFrame(
      videoRef.current,
      pendingTimestampRef.current
    );
  }


  useEffect(() => {
    return () => {
      analysisActiveRef.current = false;
      closeSocket();

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
          <p className="upload-eyebrow">
            OFFLINE PPE ANALYSIS
          </p>

          <h1>Upload Detection</h1>

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
            ? "ANALYZING"
            : "READY"}
        </div>
      </div>


      {error && (
        <div className="upload-error">
          {error}
        </div>
      )}


      <section className="upload-picker">
        <label className="upload-dropzone">
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


          <canvas
            ref={captureRef}
            style={{ display: "none" }}
          />


          <div className="upload-actions">
            <button
              onClick={startDetection}
              disabled={detecting}
            >
              {detecting
                ? "Analyzing..."
                : mediaType === "video"
                  ? "Analyze Full Video"
                  : "Run Detection"}
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
                  ? "Finish Partial Report"
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
                  IMAGE SAFETY CHECK
                </p>

                <h2>Detection Results</h2>
              </div>

              <span
                className={
                  imageViolations.length > 0
                    ? "upload-result-status danger"
                    : "upload-result-status clear"
                }
              >
                {imageViolations.length > 0
                  ? "PPE FAULTS FOUND"
                  : "NO EXPLICIT FAULTS"}
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
                    No hardhat, vest, mask, or
                    pose-assisted glove violation was
                    found in this image.
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
                        {Math.round(
                          violation.confidence * 100
                        )}%
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
              Upload analysis does not create incidents or
              modify dashboard analytics. Hardhat, vest, and
              mask faults come from explicit negative PPE
              classes. Missing gloves are inferred from
              visible wrist/hand regions using the pose model
              when no positive Gloves detection overlaps the
              hand.
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
                  VIDEO SAFETY REPORT
                </p>

                <h2>Analysis Complete</h2>

                <p className="upload-results-description">
                  Repeated detections from the same tracked
                  worker are combined into one continuous
                  violation event.
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
                  ? `${videoEvents.length} FAULTS`
                  : "NO EXPLICIT FAULTS"}
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
                    The analyzed samples did not contain
                    a hardhat, vest, mask, or confirmed
                    pose-assisted glove violation.
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
                        </strong>

                        <span>
                          {event.track_id !== null
                            ? `Person #${event.track_id}`
                            : "Worker not reliably tracked"}
                        </span>
                      </div>

                      <div className="timeline-confidence">
                        {Math.round(
                          event.confidence * 100
                        )}%
                      </div>
                    </div>
                  )
                )
              )}
            </div>


            <p className="analysis-note">
              The video is sampled every 0.5 seconds. Faults
              from the same tracked person and PPE type are
              merged when they remain continuous, preventing
              one sustained violation from being counted once
              per frame. Pose-assisted glove events must appear
              in at least two sampled frames before they are
              included in the final video report. Upload
              analysis remains separate from the PostgreSQL
              incident database.
            </p>
          </section>
        )}
    </section>
  );
}
