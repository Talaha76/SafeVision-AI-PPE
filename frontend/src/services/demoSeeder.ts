// ============================================================
// SAFEVISION AI — DEMO INCIDENT SEEDER
// ============================================================
//
// Demo source images:
//
// frontend/public/demo/demo_image1.png
// frontend/public/demo/demo_image2.png
// frontend/public/demo/demo_image3.png
// frontend/public/demo/demo_image4.png
// frontend/public/demo/demo_image5.png
//
// SafeVision runs its real browser ONNX model on each image.
//
// Supported demo violations:
//
// NO-Hardhat
// NO-Mask
// NO-Safety Vest
// NO-Gloves (MediaPipe inferred)
//
// No manually fabricated boxes or percentages are used.
//
// ============================================================

import {
  ppeDetector,
  type PPEDetection,
} from "./ppeDetector";

import {
  gloveInference,
} from "./gloveInference";


type DemoStatusResponse = {
  ready: boolean;
  demo_ids: number[];
};


type DemoIncidentResponse = {
  created: boolean;
  evidence_saved: boolean;
};


type DemoAnalysis = {
  incidentId: number;

  trackId: number;

  missingPpe: string;

  confidence:
    number | null;

  inferred: boolean;

  evidenceImage: string;
};


const configuredApiUrl =
  import.meta.env
    .VITE_API_URL
    ?.trim();


function buildApiBaseUrl():
  string {
  const raw =
    configuredApiUrl
    || "http://127.0.0.1:8000/api";

  const withoutTrailingSlash =
    raw.replace(
      /\/+$/,
      "",
    );

  if (
    withoutTrailingSlash.endsWith(
      "/api",
    )
  ) {
    return withoutTrailingSlash;
  }

  return (
    `${withoutTrailingSlash}/api`
  );
}


const API_BASE_URL =
  buildApiBaseUrl();


const DEMO_IMAGES = [
  {
    incidentId: 1,
    trackId: 9001,
    url:
      "/demo/demo_image1.png",
  },

  {
    incidentId: 2,
    trackId: 9002,
    url:
      "/demo/demo_image2.png",
  },

  {
    incidentId: 3,
    trackId: 9003,
    url:
      "/demo/demo_image3.png",
  },

  {
    incidentId: 4,
    trackId: 9004,
    url:
      "/demo/demo_image4.png",
  },

  {
    incidentId: 5,
    trackId: 9005,
    url:
      "/demo/demo_image5.png",
  },
] as const;


const TRAINED_NEGATIVE_CLASSES:
  Record<string, string> = {
    no_hardhat:
      "hardhat",

    no_mask:
      "mask",

    no_vest:
      "vest",
  };


const EVIDENCE_MAX_WIDTH =
  960;


const EVIDENCE_JPEG_QUALITY =
  0.82;


async function apiGet<T>(
  path: string,
): Promise<T> {
  const response =
    await fetch(
      `${API_BASE_URL}${path}`,
    );

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `${response.status} `
      + `${response.statusText}`
      + (
        body
          ? ` — ${body}`
          : ""
      ),
    );
  }

  return response.json();
}


async function apiPost<
  TResponse,
  TBody,
>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const response =
    await fetch(
      `${API_BASE_URL}${path}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            body,
          ),
      },
    );

  if (!response.ok) {
    const responseBody =
      await response.text();

    throw new Error(
      `${response.status} `
      + `${response.statusText}`
      + (
        responseBody
          ? ` — ${responseBody}`
          : ""
      ),
    );
  }

  return response.json();
}


function loadImage(
  url: string,
): Promise<HTMLImageElement> {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const image =
        new Image();

      image.onload =
        () => {
          resolve(
            image,
          );
        };

      image.onerror =
        () => {
          reject(
            new Error(
              `Could not load demo image: ${url}`,
            ),
          );
        };

      image.src =
        url;
    },
  );
}


function trainedMissingPpe(
  detection: PPEDetection,
): string | null {
  return (
    TRAINED_NEGATIVE_CLASSES[
      detection.className
    ]
    ?? null
  );
}


function strongestTrainedViolation(
  detections:
    PPEDetection[],
): PPEDetection | null {
  const violations =
    detections
      .filter(
        detection =>
          trainedMissingPpe(
            detection,
          ) !== null,
      )
      .sort(
        (
          a,
          b,
        ) =>
          b.confidence
          - a.confidence,
      );

  return (
    violations[0]
    ?? null
  );
}


function strongestInferredGlove(
  detections:
    PPEDetection[],
): PPEDetection | null {
  const gloves =
    detections
      .filter(
        detection =>
          detection.className
          === "no_gloves",
      )
      .sort(
        (
          a,
          b,
        ) =>
          b.confidence
          - a.confidence,
      );

  return (
    gloves[0]
    ?? null
  );
}


function missingPpeFromDetection(
  detection:
    PPEDetection,
): string | null {
  if (
    detection.className
    === "no_gloves"
  ) {
    return "gloves";
  }

  return (
    trainedMissingPpe(
      detection,
    )
  );
}


function isInferredGlove(
  detection:
    PPEDetection,
): boolean {
  return (
    detection.className
    === "no_gloves"
  );
}


function drawLabel(
  ctx:
    CanvasRenderingContext2D,

  text: string,

  x: number,

  y: number,

  fontSize: number,
) {
  ctx.font =
    `700 ${fontSize}px Arial`;

  const paddingX =
    7;

  const paddingY =
    5;

  const width =
    ctx
      .measureText(
        text,
      )
      .width
    + paddingX * 2;

  const height =
    fontSize
    + paddingY * 2;

  const labelX =
    Math.max(
      0,
      Math.min(
        x,
        ctx.canvas.width
        - width,
      ),
    );

  const labelY =
    Math.max(
      height,
      y,
    );

  ctx.fillStyle =
    "#dc2626";

  ctx.fillRect(
    labelX,
    labelY - height,
    width,
    height,
  );

  ctx.fillStyle =
    "#ffffff";

  ctx.fillText(
    text,
    labelX + paddingX,
    labelY - paddingY - 2,
  );
}


function annotatedEvidence(
  image:
    HTMLImageElement,

  violation:
    PPEDetection,
): string {
  const scale =
    Math.min(
      1,

      EVIDENCE_MAX_WIDTH
      / image.naturalWidth,
    );

  const width =
    Math.max(
      1,

      Math.round(
        image.naturalWidth
        * scale,
      ),
    );

  const height =
    Math.max(
      1,

      Math.round(
        image.naturalHeight
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
    throw new Error(
      "Could not create demo evidence canvas.",
    );
  }

  ctx.drawImage(
    image,
    0,
    0,
    width,
    height,
  );

  const [
    sourceX1,
    sourceY1,
    sourceX2,
    sourceY2,
  ] =
    violation.xyxy;

  const x1 =
    sourceX1 * scale;

  const y1 =
    sourceY1 * scale;

  const x2 =
    sourceX2 * scale;

  const y2 =
    sourceY2 * scale;

  const lineWidth =
    Math.max(
      3,

      Math.round(
        width / 350,
      ),
    );

  const fontSize =
    Math.max(
      14,

      Math.round(
        width / 58,
      ),
    );

  ctx.strokeStyle =
    "#ef4444";

  ctx.lineWidth =
    lineWidth;

  ctx.strokeRect(
    x1,
    y1,
    x2 - x1,
    y2 - y1,
  );

  const label =
    isInferredGlove(
      violation,
    )
      ? (
          "NO-Gloves (inferred)"
        )
      : (
          `${violation.rawClassName} ${
            Math.round(
              violation.confidence
              * 100,
            )
          }%`
        );

  drawLabel(
    ctx,
    label,
    x1,
    y1,
    fontSize,
  );

  return (
    canvas.toDataURL(
      "image/jpeg",
      EVIDENCE_JPEG_QUALITY,
    )
  );
}


async function analyzeDemoImage(
  incidentId: number,

  trackId: number,

  url: string,
): Promise<DemoAnalysis> {
  const image =
    await loadImage(
      url,
    );

  if (
    image.naturalWidth <= 0
    || image.naturalHeight <= 0
  ) {
    throw new Error(
      `Invalid demo image dimensions: ${url}`,
    );
  }

  const trainedDetections =
    await ppeDetector.detect(
      image,

      image.naturalWidth,

      image.naturalHeight,

      0.35,

      0.45,
    );

  /*
   * Prefer an actual trained negative class.
   */
  const trainedViolation =
    strongestTrainedViolation(
      trainedDetections,
    );

  if (trainedViolation) {
    const missingPpe =
      missingPpeFromDetection(
        trainedViolation,
      );

    if (!missingPpe) {
      throw new Error(
        `Could not normalize demo violation ${incidentId}.`,
      );
    }

    return {
      incidentId,

      trackId,

      missingPpe,

      confidence:
        trainedViolation.confidence,

      inferred:
        false,

      evidenceImage:
        annotatedEvidence(
          image,
          trainedViolation,
        ),
    };
  }

  /*
   * If ONNX did not find a trained negative,
   * try SafeVision's existing NO-Gloves inference.
   */
  let inferredGloveDetections:
    PPEDetection[] = [];

  try {
    await (
      gloveInference
        .startSession(
          "image",
        )
    );

    inferredGloveDetections =
      await (
        gloveInference
          .inferNoGloves(
            image,

            image.naturalWidth,

            image.naturalHeight,

            trainedDetections,

            "image",
          )
      );

  } catch (
    gloveError
  ) {
    console.warn(
      "[SafeVision] Demo NO-Gloves inference unavailable:",
      gloveError,
    );
  }

  const inferredViolation =
    strongestInferredGlove(
      inferredGloveDetections,
    );

  if (!inferredViolation) {
    throw new Error(
      `Demo image ${incidentId} did not produce `
      + "NO-Hardhat, NO-Mask, NO-Safety Vest, "
      + "or inferred NO-Gloves. "
      + "Use a different demo image.",
    );
  }

  return {
    incidentId,

    trackId,

    missingPpe:
      "gloves",

    /*
     * Do not present the MediaPipe/skin heuristic
     * score as trained-model confidence.
     */
    confidence:
      null,

    inferred:
      true,

    evidenceImage:
      annotatedEvidence(
        image,
        inferredViolation,
      ),
  };
}


async function seedAllDemoIncidents():
  Promise<void> {
  await (
    ppeDetector.load()
  );

  /*
   * Analyze all five before writing anything.
   */
  const analyses:
    DemoAnalysis[] = [];

  for (
    const item
    of DEMO_IMAGES
  ) {
    const result =
      await analyzeDemoImage(
        item.incidentId,

        item.trackId,

        item.url,
      );

    analyses.push(
      result,
    );
  }

  /*
   * All five passed.
   * Now save IDs #1-#5.
   */
  for (
    const analysis
    of analyses
  ) {
    await apiPost<
      DemoIncidentResponse,

      {
        incident_id:
          number;

        camera_id:
          number;

        track_id:
          number;

        missing_ppe:
          string;

        confidence:
          number | null;

        inferred:
          boolean;

        evidence_image:
          string;
      }
    >(
      "/browser-incidents/demo",

      {
        incident_id:
          analysis.incidentId,

        camera_id:
          1,

        track_id:
          analysis.trackId,

        missing_ppe:
          analysis.missingPpe,

        confidence:
          analysis.confidence,

        inferred:
          analysis.inferred,

        evidence_image:
          analysis.evidenceImage,
      },
    );
  }
}


export async function ensureDemoIncidents():
  Promise<void> {
  const status =
    await apiGet<
      DemoStatusResponse
    >(
      "/browser-incidents/demo/status",
    );

  if (!status.ready) {
    console.info(
      "[SafeVision] Creating demo incidents #1-#5...",
    );

    await (
      seedAllDemoIncidents()
    );
  }

  /*
   * Make the five permanent demo incidents
   * recent enough to contribute to today's
   * and weekly dashboard analytics.
   *
   * This does not rerun inference.
   */
  await apiPost<
    DemoStatusResponse,

    Record<
      string,
      never
    >
  >(
    "/browser-incidents/demo/refresh",

    {},
  );

  console.info(
    "[SafeVision] Demo incidents #1-#5 are ready.",
  );
}