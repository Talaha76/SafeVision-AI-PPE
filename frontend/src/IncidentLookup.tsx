// ============================================================
// SAFEVISION AI — INCIDENT LOOKUP
// ============================================================
//
// Lets users search for a specific incident by ID, view its
// details, and load any available evidence from the backend.
//
// ============================================================

import {
  useState,
} from 'react'
import type { FormEvent } from 'react'

import { getJson } from './api'
import type { Incident } from './types'


const API_BASE_URL =
  (
    import.meta.env.VITE_API_URL
    ?? 'http://127.0.0.1:8000/api'
  ).replace(/\/$/, '')


function formatViolation(
  value: string
) {
  return value
    .replace(/_/g, ' ')
    .replace(
      /\b\w/g,
      letter => letter.toUpperCase()
    )
}


export default function IncidentLookup() {
  const [incidentId, setIncidentId] =
    useState('')

  const [incident, setIncident] =
    useState<Incident | null>(null)

  const [loading, setLoading] =
    useState(false)

  const [error, setError] =
    useState('')

  const [
    evidenceUnavailable,
    setEvidenceUnavailable,
  ] = useState(false)


  async function searchIncident(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()

    const id = Number(incidentId)

    if (
      !Number.isInteger(id)
      || id <= 0
    ) {
      setError(
        'Enter a valid incident ID.'
      )

      setIncident(null)
      setEvidenceUnavailable(false)
      return
    }

    try {
      setLoading(true)
      setError('')
      setIncident(null)
      setEvidenceUnavailable(false)

      const result =
        await getJson<Incident>(
          `/incidents/${id}`
        )

      setIncident(result)

    } catch {
      setError(
        `Incident #${id} was not found.`
      )

      setIncident(null)
      setEvidenceUnavailable(false)

    } finally {
      setLoading(false)
    }
  }


  function clearSearch() {
    setIncidentId('')
    setIncident(null)
    setError('')
    setEvidenceUnavailable(false)
  }


  function evidenceUrl(
    id: number
  ) {
    return (
      `${API_BASE_URL}` +
      `/incidents/${id}/evidence`
    )
  }


  return (
    <section className="panel incidentLookup">

      <div className="lookupHeader">
        <div>
          <h2>
            Incident lookup
          </h2>

          <p>
            Jump straight to one incident and its
            evidence snapshot.
          </p>
        </div>
      </div>


      <form
        className="lookupForm"
        onSubmit={searchIncident}
      >

        <input
          type="number"
          min="1"
          step="1"
          value={incidentId}
          onChange={(event) =>
            setIncidentId(
              event.target.value
            )
          }
          placeholder="Incident ID, e.g. 42"
          aria-label="Incident ID"
        />


        <button
          type="submit"
          disabled={loading}
        >
          {loading
            ? 'Searching…'
            : 'Search'}
        </button>


        {(incident || error) && (
          <button
            type="button"
            className="lookupClearButton"
            onClick={clearSearch}
          >
            Clear
          </button>
        )}

      </form>


      {error && (
        <div className="lookupError">
          {error}
        </div>
      )}


      {incident && (
        <div className="lookupResult">

          <div className="lookupResultHeader">

            <div>

              <h3>
                Incident #{incident.id}
              </h3>
            </div>


            <span
              className={
                incident.status === 'resolved'
                  ? 'lookupStatus resolved'
                  : `lookupStatus open status-${incident.status}`
              }
            >
              {incident.status}
            </span>

          </div>


          <div className="lookupDetails">

            <div>
              <span>
                Incident ID
              </span>

              <strong>
                #{incident.id}
              </strong>
            </div>


            <div>
              <span>
                Detected
              </span>

              <strong>
                {new Date(
                  incident.detected_at
                ).toLocaleString()}
              </strong>
            </div>


            <div>
              <span>
                Violation
              </span>

              <strong>
                {formatViolation(
                  incident.violation_type
                )}
              </strong>
            </div>


            <div>
              <span>
                Severity
              </span>

              <strong>
                {incident.severity
                  .charAt(0)
                  .toUpperCase()
                  + incident.severity.slice(1)}
              </strong>
            </div>


            <div>
              <span>
                Track ID
              </span>

              <strong>
                #{incident.track_id}
              </strong>
            </div>


            <div>
              <span>
                Confidence
              </span>

              <strong>
                {
                  incident.confidence == null
                    ? '—'
                    : `${Math.round(
                        incident.confidence * 100
                      )}%`
                }
              </strong>
            </div>


            <div>
              <span>
                Status
              </span>

              <strong>
                {incident.status
                  .charAt(0)
                  .toUpperCase()
                  + incident.status.slice(1)}
              </strong>
            </div>

          </div>


          <div className="lookupEvidence">

            <div className="lookupEvidenceHeading">

              <div>

                <h3>
                  Evidence snapshot
                </h3>
              </div>

            </div>


            {!evidenceUnavailable ? (

              <img
                key={incident.id}
                className="lookupEvidenceImage"
                src={
                  evidenceUrl(
                    incident.id
                  )
                }
                alt={
                  `Evidence for incident #${incident.id}`
                }
                onError={() =>
                  setEvidenceUnavailable(
                    true
                  )
                }
              />

            ) : (

              <div className="lookupNoEvidence">

                <strong>
                  Evidence image not available
                </strong>

                <p>
                  The incident record exists,
                  but its evidence image is not
                  currently stored in the
                  database. It may have been
                  created before evidence
                  storage was enabled, created
                  manually, or removed by the
                  latest-100 evidence retention
                  policy.
                </p>

              </div>

            )}

          </div>

        </div>
      )}

    </section>
  )
}
