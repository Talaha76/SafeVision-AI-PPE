// ============================================================
// SAFEVISION AI — API CLIENT
// ============================================================
//
// Configures the backend API URL and provides reusable
// GET, POST, and PATCH helpers.
//
// It also starts the permanent demo initialization once
// when the frontend application loads.
//
// ============================================================

import {
  ensureDemoIncidents,
} from "./services/demoSeeder";


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


export const API_BASE_URL =
  buildApiBaseUrl();


function normalizePath(
  path: string,
): string {
  if (
    path.startsWith(
      "/",
    )
  ) {
    return path;
  }

  return (
    `/${path}`
  );
}


export async function getJson<T>(
  path: string,
): Promise<T> {
  const url =
    `${API_BASE_URL}${normalizePath(path)}`;

  console.log(
    "[SafeVision API] GET",
    url,
  );

  const response =
    await fetch(
      url,
    );

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `${response.status} ${response.statusText}${
        body
          ? ` — ${body}`
          : ""
      }`,
    );
  }

  return response.json();
}


export async function patchJson<T>(
  path: string,

  body: unknown,
): Promise<T> {
  const url =
    `${API_BASE_URL}${normalizePath(path)}`;

  console.log(
    "[SafeVision API] PATCH",
    url,
  );

  const response =
    await fetch(
      url,
      {
        method:
          "PATCH",

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
      `${response.status} ${response.statusText}${
        responseBody
          ? ` — ${responseBody}`
          : ""
      }`,
    );
  }

  return response.json();
}


export async function postJson<
  TResponse,
  TBody = unknown,
>(
  path: string,

  body: TBody,
): Promise<TResponse> {
  const url =
    `${API_BASE_URL}${normalizePath(path)}`;

  console.log(
    "[SafeVision API] POST",
    url,
  );

  const response =
    await fetch(
      url,
      {
        method:
          "POST",

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
      `${response.status} ${response.statusText}${
        responseBody
          ? ` — ${responseBody}`
          : ""
      }`,
    );
  }

  return response.json();
}


/*
 * ===========================================================
 * DEMO INITIALIZATION
 * ===========================================================
 *
 * App.tsx does not need to know about this.
 *
 * Since App.tsx already imports this API module,
 * the bootstrap runs once when SafeVision loads.
 */

let demoInitializationStarted =
  false;


function startDemoInitialization():
  void {
  if (
    typeof window
    === "undefined"
  ) {
    return;
  }

  if (
    demoInitializationStarted
  ) {
    return;
  }

  demoInitializationStarted =
    true;

  window.setTimeout(
    () => {
      void (
        ensureDemoIncidents()
          .catch(
            error => {
              /*
               * Demo setup should never prevent
               * the normal dashboard from loading.
               */
              console.warn(
                "[SafeVision] Demo incidents could not be initialized:",
                error,
              );
            },
          )
      );
    },
    0,
  );
}


startDemoInitialization();