// ============================================================
// SAFEVISION AI — API CLIENT
// ============================================================
//
// Configures the backend API base URL and provides reusable
// helpers for GET, POST, and PATCH JSON requests.
//
// ============================================================

const configuredApiUrl =
  import.meta.env.VITE_API_URL?.trim()


function buildApiBaseUrl(): string {
  const raw =
    configuredApiUrl ||
    "http://127.0.0.1:8000/api"

  const withoutTrailingSlash =
    raw.replace(/\/+$/, "")

  /*
   * Allow VITE_API_URL to be either:
   *
   * http://127.0.0.1:8000
   *
   * OR
   *
   * http://127.0.0.1:8000/api
   *
   * Same idea for the deployed Render URL.
   */
  if (
    withoutTrailingSlash.endsWith(
      "/api",
    )
  ) {
    return withoutTrailingSlash
  }

  return `${withoutTrailingSlash}/api`
}


export const API_BASE_URL =
  buildApiBaseUrl()


function normalizePath(
  path: string,
): string {
  if (path.startsWith("/")) {
    return path
  }

  return `/${path}`
}


export async function getJson<T>(
  path: string,
): Promise<T> {
  const url =
    `${API_BASE_URL}${normalizePath(path)}`

  console.log(
    "[SafeVision API] GET",
    url,
  )

  const response =
    await fetch(url)

  if (!response.ok) {
    const body =
      await response.text()

    throw new Error(
      `${response.status} ${response.statusText}${
        body
          ? ` — ${body}`
          : ""
      }`,
    )
  }

  return response.json()
}


export async function patchJson<T>(
  path: string,
  body: unknown,
): Promise<T> {
  const url =
    `${API_BASE_URL}${normalizePath(path)}`

  console.log(
    "[SafeVision API] PATCH",
    url,
  )

  const response =
    await fetch(
      url,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(body),
      },
    )

  if (!response.ok) {
    const responseBody =
      await response.text()

    throw new Error(
      `${response.status} ${response.statusText}${
        responseBody
          ? ` — ${responseBody}`
          : ""
      }`,
    )
  }

  return response.json()
}


export async function postJson<
  TResponse,
  TBody = unknown,
>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const url =
    `${API_BASE_URL}${normalizePath(path)}`

  console.log(
    "[SafeVision API] POST",
    url,
  )

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(body),
      },
    )

  if (!response.ok) {
    const responseBody =
      await response.text()

    throw new Error(
      `${response.status} ${response.statusText}${
        responseBody
          ? ` — ${responseBody}`
          : ""
      }`,
    )
  }

  return response.json()
}