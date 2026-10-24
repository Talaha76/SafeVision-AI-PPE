// ============================================================
// SAFEVISION AI — MAIN APPLICATION
// ============================================================
//
// Controls the main dashboard, navigation, analytics charts,
// incident history, status updates, evidence viewing, theme,
// and access to live and upload detection pages.
//
// ============================================================

import {
  Fragment,
  useEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  getJson,
  patchJson,
  postJson,
} from './api'

import type {
  DashboardCharts,
  Incident,
  Summary,
  Trend,
} from './types'

import IncidentLookup from './IncidentLookup'
import LiveDetection from './pages/LiveDetection'
import UploadDetection from './pages/UploadDetection'


type Page =
  | 'overview'
  | 'live'
  | 'upload'

type Theme =
  | 'light'
  | 'dark'

type IncidentStatus =
  | 'open'
  | 'reviewing'
  | 'resolved'
  | 'dismissed'


const API_BASE_URL =
  (
    import.meta.env.VITE_API_URL
    ?? 'http://127.0.0.1:8000/api'
  ).replace(/\/$/, '')


const INCIDENT_PAGE_SIZE = 50

type IncidentCountResponse = {
  count: number
}


function fmt(
  value: number | null | undefined,
  suffix = ''
) {
  return value == null
    ? '—'
    : `${value}${suffix}`
}


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


function badgeClass(
  prefix: string,
  value: string
) {
  return `${prefix}-${value
    .toLowerCase()
    .replace(/\s+/g, '-')}`
}


function percent(
  value: number,
  total: number
) {
  if (!total) {
    return 0
  }

  return Math.round(
    (value / total) * 100
  )
}




export default function App() {
  const [activePage, setActivePage] =
    useState<Page>('overview')

  const [theme, setTheme] =
    useState<Theme>(() => {
      const saved =
        localStorage.getItem(
          'safevision-theme'
        )

      if (
        saved === 'light'
        || saved === 'dark'
      ) {
        return saved
      }

      return window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches
        ? 'dark'
        : 'light'
    })


  const [summary, setSummary] =
    useState<Summary | null>(null)

  const [trends, setTrends] =
    useState<Trend[]>([])

  const [
    dashboardCharts,
    setDashboardCharts,
  ] =
    useState<DashboardCharts | null>(
      null
    )

  const [incidents, setIncidents] =
    useState<Incident[]>([])

  const [error, setError] =
    useState('')

  const [
    expandedIncidentId,
    setExpandedIncidentId,
  ] =
    useState<number | null>(null)

  const [
    evidenceErrors,
    setEvidenceErrors,
  ] =
    useState<Record<number, boolean>>({})

  const [
    hoveredStatus,
    setHoveredStatus,
  ] =
    useState<{
      label: string
      count: number
    } | null>(null)

  const [
    hoveredSeverity,
    setHoveredSeverity,
  ] =
    useState<{
      label: string
      count: number
    } | null>(null)

  const [
    incidentDateFilter,
    setIncidentDateFilter,
  ] = useState('')

  const [
    severityFilter,
    setSeverityFilter,
  ] = useState('all')

  const [
    violationFilter,
    setViolationFilter,
  ] = useState('all')

  const [
    statusFilter,
    setStatusFilter,
  ] = useState('all')

  const [
    incidentSearchResults,
    setIncidentSearchResults,
  ] = useState<Incident[]>([])

  const [
    incidentSearchCount,
    setIncidentSearchCount,
  ] = useState(0)

  const [
    incidentPage,
    setIncidentPage,
  ] = useState(0)

  const [
    incidentSearchLoading,
    setIncidentSearchLoading,
  ] = useState(false)

  const [
    incidentSearchError,
    setIncidentSearchError,
  ] = useState('')

  const [
    incidentStatusUpdating,
    setIncidentStatusUpdating,
  ] = useState<number | null>(null)

  const [
    clearingData,
    setClearingData,
  ] = useState(false)


  async function load() {
    try {
      setError('')

      const [
        s,
        t,
        c,
        i,
      ] =
        await Promise.all([
          getJson<Summary>(
            '/analytics/summary'
          ),

          getJson<Trend[]>(
            '/analytics/trends?days=14'
          ),

          getJson<DashboardCharts>(
            '/analytics/dashboard-charts?days=7'
          ),

          getJson<Incident[]>(
            '/incidents?limit=50'
          ),
        ])

      setSummary(s)
      setTrends(t)
      setDashboardCharts(c)
      setIncidents(i)

    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Failed to load dashboard'
      )
    }
  }


  useEffect(() => {
    load()

    const interval =
      window.setInterval(
        load,
        5000
      )

    return () => {
      window.clearInterval(interval)
    }
  }, [])


  useEffect(() => {
    document.body.classList.toggle(
      'dark-mode',
      theme === 'dark'
    )

    localStorage.setItem(
      'safevision-theme',
      theme
    )
  }, [theme])


  function toggleTheme() {
    setTheme(
      current =>
        current === 'light'
          ? 'dark'
          : 'light'
    )
  }


  async function clearDashboardData() {
    const confirmed =
      window.confirm(
        'Are you sure you want to clear all dashboard data?\n\n'
        + 'This will remove all incidents that were recorded '
        + 'through Live Detection, including their stored evidence '
        + 'and related analytics data.'
      )

    if (!confirmed) {
      return
    }

    try {
      setClearingData(true)
      setError('')

      await postJson<
        { status: string },
        Record<string, never>
      >(
        '/admin/clear-data',
        {}
      )

      setIncidentDateFilter('')
      setSeverityFilter('all')
      setViolationFilter('all')
      setStatusFilter('all')
      setIncidentPage(0)
      setExpandedIncidentId(null)
      setEvidenceErrors({})
      setIncidentSearchResults([])
      setIncidentSearchCount(0)
      setIncidentSearchError('')

      await load()

    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not clear dashboard data'
      )
    } finally {
      setClearingData(false)
    }
  }


  async function updateIncidentStatus(
    id: number,
    status: IncidentStatus
  ) {
    try {
      setIncidentStatusUpdating(id)
      setError('')

      await patchJson(
        `/incidents/${id}`,
        {
          status,
        }
      )

      await load()

      if (filtersActive) {
        await loadHistoricalIncidents(
          incidentPage
        )
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not update incident status'
      )
    } finally {
      setIncidentStatusUpdating(null)
    }
  }


  function toggleIncidentEvidence(
    id: number
  ) {
    setExpandedIncidentId(
      current =>
        current === id
          ? null
          : id
    )

    setEvidenceErrors(
      current => ({
        ...current,
        [id]: false,
      })
    )
  }


  function evidenceUrl(
    incidentId: number
  ) {
    return (
      `${API_BASE_URL}`
      + `/incidents/${incidentId}/evidence`
    )
  }


  const cards =
    summary
      ? [
          {
            label: 'Incidents today',
            value: summary.incidents_today,
            hint: 'Recorded today',
            tone: 'blue',
          },
          {
            label: 'Open incidents',
            value: summary.open_incidents,
            hint: 'Waiting for review',
            tone: 'orange',
          },
          {
            label: 'Non-compliance rate',
            value: fmt(
              summary.compliance_rate,
              '%'
            ),
            hint: 'Share of checks missing PPE',
            tone: 'indigo',
          },
          {
            label: 'Top violation',
            value:
              summary.most_common_violation
                ? formatViolation(
                    summary.most_common_violation
                  )
                : '—',
            hint: 'Most frequent issue',
            tone: 'red',
          },
          {
            label: 'Avg resolution',
            value: fmt(
              summary.avg_resolution_minutes,
              ' min'
            ),
            hint: 'Detection to resolved',
            tone: 'cyan',
          },
          {
            label: 'Duplicate reduction',
            value: fmt(
              summary.duplicate_reduction_pct,
              '%'
            ),
            hint: 'Repeat alerts suppressed',
            tone: 'green',
          },
        ]
      : []


  /* ======================================================
     CHART THEME
     ====================================================== */

  const chartStroke =
    theme === 'dark'
      ? '#ffc72c'
      : '#1f2328'

  const chartGrid =
    theme === 'dark'
      ? 'rgba(236, 233, 224, 0.08)'
      : 'rgba(31, 35, 40, 0.08)'

  const chartText =
    theme === 'dark'
      ? '#9a9d9f'
      : '#6b6f72'

  const tooltipStyle = {
    background:
      theme === 'dark'
        ? '#26292d'
        : '#ffffff',

    border:
      theme === 'dark'
        ? '1px solid #3a3e43'
        : '1px solid #e2e0d9',

    borderRadius: '8px',

    fontFamily: 'Barlow, system-ui, sans-serif',

    boxShadow:
      theme === 'dark'
        ? '0 14px 34px rgba(0,0,0,.34)'
        : '0 14px 34px rgba(15,23,42,.14)',

    color:
      theme === 'dark'
        ? '#f2f0ea'
        : '#1f2328',

    fontSize: '12px',

    padding: '10px 13px',
  }

  const tooltipLabelStyle = {
    color:
      theme === 'dark'
        ? '#ffffff'
        : '#1f2328',

    fontWeight: 700,
  }

  const tooltipItemStyle = {
    color:
      theme === 'dark'
        ? '#d6d4ce'
        : '#45494d',

    fontWeight: 600,
  }


  const ppeColors:
    Record<string, string> = {
      hardhat: '#f2b705',
      vest: '#ee6c1c',
      mask: '#3f7cac',
      gloves: '#8a6fbf',
    }


  const statusColors:
    Record<string, string> = {
      open: '#e5484d',
      reviewing: '#f2b705',
      resolved: '#2ba471',
      dismissed: '#9a9d9f',
    }


  const severityColors:
    Record<string, string> = {
      high: '#e5484d',
      medium: '#f2b705',
      low: '#3f7cac',
    }


  const statusTotal =
    dashboardCharts
      ?.status_distribution
      .reduce(
        (total, item) =>
          total + item.count,
        0
      )
    ?? 0


  const severityTotal =
    dashboardCharts
      ?.severity_distribution
      .reduce(
        (total, item) =>
          total + item.count,
        0
      )
    ?? 0


  const weeklyViolationTotal =
    dashboardCharts
      ?.weekly_by_ppe
      .reduce(
        (total, item) =>
          total + item.count,
        0
      )
    ?? 0


  const topPpe =
    dashboardCharts
      ?.weekly_by_ppe
      .reduce<
        | {
            ppe: string
            count: number
          }
        | undefined
      >(
        (best, item) =>
          !best
          || item.count > best.count
            ? item
            : best,
        undefined
      )


  const busiestDay =
    dashboardCharts
      ?.daily_by_ppe
      .reduce<
        | {
            date: string
            total: number
          }
        | undefined
      >(
        (best, day) => {
          const total =
            day.hardhat
            + day.vest
            + day.mask
            + day.gloves

          if (
            !best
            || total > best.total
          ) {
            return {
              date: day.date,
              total,
            }
          }

          return best
        },
        undefined
      )


  /* ======================================================
     INCIDENT HISTORY FILTERS

     The dashboard still loads only the newest 50 incidents.
     As soon as a filter is active, this section queries
     the backend so matching incidents can come from the full
     PostgreSQL history.
     ====================================================== */

  const filtersActive =
    incidentDateFilter !== ''
    || severityFilter !== 'all'
    || violationFilter !== 'all'
    || statusFilter !== 'all'


  const violationOptions =
    Array.from(
      new Set([
        'hardhat',
        'vest',
        'mask',
        'gloves',
        ...incidents.map(
          incident =>
            incident.violation_type
        ),
        ...incidentSearchResults.map(
          incident =>
            incident.violation_type
        ),
      ].filter(Boolean))
    ).sort(
      (a, b) =>
        a.localeCompare(b)
    )


  function buildIncidentFilterParams() {
    const params =
      new URLSearchParams()

    if (severityFilter !== 'all') {
      params.set(
        'severity',
        severityFilter
      )
    }

    if (violationFilter !== 'all') {
      params.set(
        'violation_type',
        violationFilter
      )
    }

    if (statusFilter !== 'all') {
      params.set(
        'status',
        statusFilter
      )
    }

    if (incidentDateFilter) {
      const start =
        new Date(
          `${incidentDateFilter}T00:00:00`
        )

      const end =
        new Date(
          `${incidentDateFilter}T23:59:59.999`
        )

      params.set(
        'start',
        start.toISOString()
      )

      params.set(
        'end',
        end.toISOString()
      )
    }

    return params
  }


  async function loadHistoricalIncidents(
    page: number
  ) {
    if (!filtersActive) {
      setIncidentSearchResults([])
      setIncidentSearchCount(0)
      setIncidentSearchError('')
      return
    }

    setIncidentSearchLoading(true)
    setIncidentSearchError('')

    try {
      const baseParams =
        buildIncidentFilterParams()

      const pageParams =
        new URLSearchParams(
          baseParams
        )

      pageParams.set(
        'limit',
        String(INCIDENT_PAGE_SIZE)
      )

      pageParams.set(
        'offset',
        String(
          page * INCIDENT_PAGE_SIZE
        )
      )

      const [
        rows,
        countResult,
      ] =
        await Promise.all([
          getJson<Incident[]>(
            `/incidents?${pageParams.toString()}`
          ),

          getJson<IncidentCountResponse>(
            `/incidents/count?${baseParams.toString()}`
          ),
        ])

      setIncidentSearchResults(
        rows
      )

      setIncidentSearchCount(
        countResult.count
      )

      setExpandedIncidentId(null)

    } catch (e) {
      setIncidentSearchError(
        e instanceof Error
          ? e.message
          : 'Failed to load incident history'
      )
    } finally {
      setIncidentSearchLoading(false)
    }
  }


  useEffect(() => {
    if (!filtersActive) {
      setIncidentSearchResults([])
      setIncidentSearchCount(0)
      setIncidentSearchError('')
      setIncidentSearchLoading(false)
      setIncidentPage(0)
      return
    }

    const timer =
      window.setTimeout(
        () => {
          void loadHistoricalIncidents(
            incidentPage
          )
        },
        250
      )

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    incidentDateFilter,
    severityFilter,
    violationFilter,
    statusFilter,
    incidentPage,
  ])


  const displayedIncidents =
    filtersActive
      ? incidentSearchResults
      : incidents


  const displayedIncidentTotal =
    filtersActive
      ? incidentSearchCount
      : incidents.length


  const incidentPageCount =
    filtersActive
      ? Math.max(
          1,
          Math.ceil(
            incidentSearchCount
            / INCIDENT_PAGE_SIZE
          )
        )
      : 1


  function clearIncidentFilters() {
    setIncidentDateFilter('')
    setSeverityFilter('all')
    setViolationFilter('all')
    setStatusFilter('all')
    setIncidentPage(0)
    setExpandedIncidentId(null)
  }


  const pageMeta: Record<Page, { title: string, subtitle: string }> = {
    overview: {
      title: 'Safety overview',
      subtitle: 'PPE compliance, incident trends and the review queue, refreshed every 5 seconds.',
    },
    live: {
      title: 'Live detection',
      subtitle: '',
    },
    upload: {
      title: 'Upload detection',
      subtitle: '',
    },
  }

  const navItems: {
    id: Page
    label: string
    icon: ReactNode
  }[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
          <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
          <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
        </svg>
      ),
    },
    {
      id: 'live',
      label: 'Live detection',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6.5" width="12.5" height="11" rx="2" />
          <path d="M15.5 10.5 21 7.5v9l-5.5-3" />
        </svg>
      ),
    },
    {
      id: 'upload',
      label: 'Upload',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" />
          <path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
        </svg>
      ),
    },
  ]


  return (
    <div className="appShell">

      {/* ==================================================
          SIDEBAR
          ================================================== */}

      <aside className="sidebar">

        <div className="brandArea">

          <div className="brandMark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M6 20.5a10 10 0 0 1 20 0" />
              <path d="M4 20.5h24v3H4z" />
              <path d="M16 10.5v4" />
            </svg>
          </div>

          <div className="brandCopy">
            <strong>SafeVision</strong>
            <span>PPE monitoring</span>
          </div>

        </div>


        <nav className="mainNav" aria-label="Main">
          {
            navItems.map(item => (
              <button
                key={item.id}
                className={
                  activePage === item.id
                    ? 'navButton active'
                    : 'navButton'
                }
                aria-current={
                  activePage === item.id
                    ? 'page'
                    : undefined
                }
                onClick={() =>
                  setActivePage(item.id)
                }
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))
          }
        </nav>


        <div className="sidebarFooter">

          <span
            className={
              summary
                ? 'systemPill online'
                : 'systemPill'
            }
          >
            <span className="systemDot" />
            {
              summary
                ? 'Backend connected'
                : 'Connecting…'
            }
          </span>

          <button
            className="themeToggle"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
          >
            {
              theme === 'light'
                ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
                  </svg>
                )
                : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
                  </svg>
                )
            }
            <span>
              {
                theme === 'light'
                  ? 'Dark mode'
                  : 'Light mode'
              }
            </span>
          </button>

        </div>

      </aside>


      <main className="appMain">

      {
        activePage === 'overview'
        && (
          <header className="appHeader">

            <div className="pageTitle">
              <h1>{pageMeta.overview.title}</h1>
              <p>{pageMeta.overview.subtitle}</p>
            </div>

            <div className="headerActions">

              <button
                className="refreshButton"
                onClick={load}
                disabled={clearingData}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
                </svg>
                Refresh
              </button>

              <button
                className="refreshButton dangerButton"
                onClick={clearDashboardData}
                disabled={clearingData}
              >
                {
                  clearingData
                    ? 'Clearing…'
                    : 'Clear data'
                }
              </button>

            </div>

          </header>
        )
      }


      {
        activePage === 'overview'
        && (
          <div
            className="dashboardCaution"
            role="note"
            aria-label="Live Detection data reminder"
          >
            <span className="dashboardCautionIcon" aria-hidden="true">
              !
            </span>

            <p>
              <strong>Finished testing Live Detection?</strong>
              {' '}
              Press
              {' '}
              <span className="dashboardCautionAction">
                Clear data
              </span>
              {' '}
              above to remove the incidents recorded in your session. Demo data stays in place.
            </p>
          </div>
        )
      }


      {/* ==================================================
          PAGE
          ================================================== */}

      {
        activePage === 'live'
          ? (
            <LiveDetection />
          )
          : activePage === 'upload'
            ? (
              <UploadDetection />
            )
            : (

              <>

                {
                  error
                  && (

                    <div className="globalError">
                      <strong>
                        Dashboard connection error
                      </strong>

                      <span>
                        {error}
                      </span>
                    </div>

                  )
                }


                {
                  !summary
                  && !error
                  && (

                    <div className="loadingPanel">
                      Loading SafeVision data…
                    </div>

                  )
                }


                {
                  summary
                  && (

                    <>

                      {/* =====================================
                          KPI CARDS
                          ===================================== */}

                      <section className="cards">

                        {
                          cards.map(
                            card => (

                              <article
                                className={
                                  `card metricCard metric-${card.tone}`
                                }
                                key={card.label}
                              >

                                <div className="metricTop">

                                  <span className="metricLabel">
                                    {card.label}
                                  </span>

                                  <span
                                    className="metricIndicator"
                                  />

                                </div>

                                <strong className="metricValue">
                                  {card.value}
                                </strong>

                                <span className="metricHint">
                                  {card.hint}
                                </span>

                              </article>

                            )
                          )
                        }

                      </section>


                      {/* =====================================
                          14 DAY TREND
                          ===================================== */}

                      <section className="panel chartPanel">

                        <div className="panelHeader">

                          <div>

                            <h2>
                              Incidents over time
                            </h2>

                            <p className="panelDescription">
                              Daily incident volume across
                              the last 14 days.
                            </p>

                          </div>

                          <span className="periodBadge">
                            14 days
                          </span>

                        </div>


                        <div className="chart">

                          <ResponsiveContainer
                            width="100%"
                            height="100%"
                          >

                            <LineChart
                              data={trends}
                              margin={{
                                top: 18,
                                right: 12,
                                left: -10,
                                bottom: 4,
                              }}
                            >

                              <CartesianGrid
                                stroke={chartGrid}
                                strokeDasharray="3 7"
                                vertical={false}
                              />

                              <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{
                                  fill: chartText,
                                  fontSize: 11,
                                }}
                                dy={8}
                              />

                              <YAxis
                                allowDecimals={false}
                                axisLine={false}
                                tickLine={false}
                                tick={{
                                  fill: chartText,
                                  fontSize: 11,
                                }}
                              />

                              <Tooltip
                                contentStyle={
                                  tooltipStyle
                                }
                                labelStyle={
                                  tooltipLabelStyle
                                }
                                itemStyle={
                                  tooltipItemStyle
                                }
                              />

                              <Line
                                type="monotone"
                                dataKey="count"
                                name="Incidents"
                                stroke={chartStroke}
                                strokeWidth={2.5}
                                dot={false}
                                activeDot={{
                                  r: 5,
                                  strokeWidth: 0,
                                  fill: chartStroke,
                                }}
                              />

                            </LineChart>

                          </ResponsiveContainer>

                        </div>

                      </section>


                      {/* =====================================
                          PROFESSIONAL ANALYTICS
                          ===================================== */}

                      {
                        dashboardCharts
                        && (

                          <section className="proAnalyticsGrid">


                            {/* ================================
                                PPE BREAKDOWN
                                ================================ */}

                            <article className="proChartCard">

                              <div className="proChartHeader">

                                <div>

                                  <h2>
                                    Violations by PPE type
                                  </h2>

                                  <p>
                                    Ranked safety violations
                                    recorded during the last
                                    seven days.
                                  </p>

                                </div>

                                <span className="proPeriodBadge">
                                  7 days
                                </span>

                              </div>


                              <div className="proMetricStrip">

                                <div>
                                  <span>
                                    Total violations
                                  </span>

                                  <strong>
                                    {weeklyViolationTotal}
                                  </strong>
                                </div>

                                <div>
                                  <span>
                                    Most frequent
                                  </span>

                                  <strong>
                                    {topPpe?.ppe ?? '—'}
                                  </strong>
                                </div>

                              </div>


                              <div className="proHorizontalChart">

                                <ResponsiveContainer
                                  width="100%"
                                  height="100%"
                                >

                                  <BarChart
                                    data={
                                      dashboardCharts
                                        .weekly_by_ppe
                                    }
                                    layout="vertical"
                                    margin={{
                                      top: 6,
                                      right: 42,
                                      left: 10,
                                      bottom: 0,
                                    }}
                                  >

                                    <defs>

                                      <linearGradient
                                        id="hardhatGradient"
                                        x1="0"
                                        y1="0"
                                        x2="1"
                                        y2="0"
                                      >
                                        <stop
                                          offset="0%"
                                          stopColor="#3b82f6"
                                        />
                                        <stop
                                          offset="100%"
                                          stopColor="#60a5fa"
                                        />
                                      </linearGradient>

                                      <linearGradient
                                        id="vestGradient"
                                        x1="0"
                                        y1="0"
                                        x2="1"
                                        y2="0"
                                      >
                                        <stop
                                          offset="0%"
                                          stopColor="#7c3aed"
                                        />
                                        <stop
                                          offset="100%"
                                          stopColor="#a78bfa"
                                        />
                                      </linearGradient>

                                      <linearGradient
                                        id="maskGradient"
                                        x1="0"
                                        y1="0"
                                        x2="1"
                                        y2="0"
                                      >
                                        <stop
                                          offset="0%"
                                          stopColor="#0891b2"
                                        />
                                        <stop
                                          offset="100%"
                                          stopColor="#22d3ee"
                                        />
                                      </linearGradient>

                                      <linearGradient
                                        id="glovesGradient"
                                        x1="0"
                                        y1="0"
                                        x2="1"
                                        y2="0"
                                      >
                                        <stop
                                          offset="0%"
                                          stopColor="#d97706"
                                        />
                                        <stop
                                          offset="100%"
                                          stopColor="#fbbf24"
                                        />
                                      </linearGradient>

                                    </defs>


                                    <CartesianGrid
                                      stroke={chartGrid}
                                      strokeDasharray="3 7"
                                      horizontal={false}
                                    />


                                    <XAxis
                                      type="number"
                                      allowDecimals={false}
                                      axisLine={false}
                                      tickLine={false}
                                      tick={{
                                        fill: chartText,
                                        fontSize: 10,
                                      }}
                                    />


                                    <YAxis
                                      type="category"
                                      dataKey="ppe"
                                      axisLine={false}
                                      tickLine={false}
                                      width={68}
                                      tick={{
                                        fill: chartText,
                                        fontSize: 11,
                                        fontWeight: 700,
                                      }}
                                    />


                                    <Tooltip
                                      cursor={{
                                        fill:
                                          theme === 'dark'
                                            ? 'rgba(255,255,255,.025)'
                                            : 'rgba(15,23,42,.025)',
                                      }}
                                      contentStyle={
                                        tooltipStyle
                                      }
                                      labelStyle={
                                        tooltipLabelStyle
                                      }
                                      itemStyle={
                                        tooltipItemStyle
                                      }
                                    />


                                    <Bar
                                      dataKey="count"
                                      name="Violations"
                                      barSize={18}
                                      radius={[
                                        0,
                                        4,
                                        4,
                                        0,
                                      ]}
                                    >

                                      {
                                        dashboardCharts
                                          .weekly_by_ppe
                                          .map(
                                            item => {

                                              const key =
                                                item
                                                  .ppe
                                                  .toLowerCase()

                                              const fill =
                                                ppeColors[key]
                                                ?? '#9a9d9f'

                                              return (

                                                <Cell
                                                  key={item.ppe}
                                                  fill={fill}
                                                />

                                              )
                                            }
                                          )
                                      }


                                      <LabelList
                                        dataKey="count"
                                        position="right"
                                        fill={chartText}
                                        fontSize={11}
                                        fontWeight={700}
                                      />

                                    </Bar>

                                  </BarChart>

                                </ResponsiveContainer>

                              </div>

                            </article>


                            {/* ================================
                                STATUS DONUT
                                ================================ */}

                            <article className="proChartCard">

                              <div className="proChartHeader">

                                <div>

                                  <h2>
                                    Resolution status
                                  </h2>

                                  <p>
                                    Current open versus resolved
                                    incident workload.
                                  </p>

                                </div>

                              </div>


                              <div className="proDonutLayout">

                                <div className="proDonutVisual">

                                  <ResponsiveContainer
                                    width="100%"
                                    height="100%"
                                  >

                                    <PieChart>

                                      <Pie
                                        data={
                                          dashboardCharts
                                            .status_distribution
                                        }
                                        dataKey="count"
                                        nameKey="status"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={78}
                                        outerRadius={100}
                                        paddingAngle={2}
                                        cornerRadius={3}
                                        stroke="none"
                                        onMouseEnter={(
                                          _,
                                          index
                                        ) => {

                                          const item =
                                            dashboardCharts
                                              .status_distribution[
                                                index
                                              ]

                                          setHoveredStatus({
                                            label:
                                              item.status,
                                            count:
                                              item.count,
                                          })
                                        }}
                                        onMouseLeave={() =>
                                          setHoveredStatus(
                                            null
                                          )
                                        }
                                      >

                                        {
                                          dashboardCharts
                                            .status_distribution
                                            .map(
                                              item => {

                                                const key =
                                                  item
                                                    .status
                                                    .toLowerCase()

                                                return (

                                                  <Cell
                                                    key={
                                                      item.status
                                                    }
                                                    fill={
                                                      statusColors[
                                                        key
                                                      ]
                                                      ?? '#64748b'
                                                    }
                                                  />

                                                )
                                              }
                                            )
                                        }

                                      </Pie>

                                    </PieChart>

                                  </ResponsiveContainer>


                                  <div className="proDonutCenter">

                                    <strong>
                                      {
                                        hoveredStatus
                                          ? hoveredStatus.count
                                          : statusTotal
                                      }
                                    </strong>

                                    <span>
                                      {
                                        hoveredStatus
                                          ? hoveredStatus.label
                                          : 'total'
                                      }
                                    </span>

                                  </div>

                                </div>


                                <div className="proDonutBreakdown">

                                  {
                                    dashboardCharts
                                      .status_distribution
                                      .map(
                                        item => {

                                          const key =
                                            item
                                              .status
                                              .toLowerCase()

                                          return (

                                            <div
                                              className="proBreakdownRow"
                                              key={item.status}
                                            >

                                              <div className="proBreakdownLabel">

                                                <span
                                                  className="proLegendDot"
                                                  style={{
                                                    background:
                                                      statusColors[
                                                        key
                                                      ],
                                                  }}
                                                />

                                                <span>
                                                  {item.status}
                                                </span>

                                              </div>


                                              <div className="proBreakdownValue">

                                                <strong>
                                                  {item.count}
                                                </strong>

                                                <small>
                                                  {
                                                    percent(
                                                      item.count,
                                                      statusTotal
                                                    )
                                                  }%
                                                </small>

                                              </div>

                                            </div>

                                          )
                                        }
                                      )
                                  }

                                </div>

                              </div>

                            </article>


                            {/* ================================
                                WEEKLY STACKED CHART
                                ================================ */}

                            <article className="proChartCard">

                              <div className="proChartHeader">

                                <div>

                                  <h2>
                                    PPE violations by day
                                  </h2>

                                  <p>
                                    Daily violation mix across
                                    the last seven days.
                                  </p>

                                </div>

                                <span className="proPeriodBadge">
                                  7 days
                                </span>

                              </div>


                              <div className="proMetricStrip">

                                <div>
                                  <span>
                                    Weekly total
                                  </span>

                                  <strong>
                                    {weeklyViolationTotal}
                                  </strong>
                                </div>

                                <div>
                                  <span>
                                    Busiest day
                                  </span>

                                  <strong>
                                    {
                                      busiestDay?.total
                                        ? busiestDay.date
                                        : '—'
                                    }
                                  </strong>
                                </div>

                              </div>


                              <div className="proSeriesLegend">

                                <span>
                                  <i
                                    style={{
                                      background:
                                        ppeColors.hardhat,
                                    }}
                                  />
                                  Hardhat
                                </span>

                                <span>
                                  <i
                                    style={{
                                      background:
                                        ppeColors.vest,
                                    }}
                                  />
                                  Vest
                                </span>

                                <span>
                                  <i
                                    style={{
                                      background:
                                        ppeColors.mask,
                                    }}
                                  />
                                  Mask
                                </span>

                                <span>
                                  <i
                                    style={{
                                      background:
                                        ppeColors.gloves,
                                    }}
                                  />
                                  Gloves
                                </span>

                              </div>


                              <div className="proStackedChart">

                                <ResponsiveContainer
                                  width="100%"
                                  height="100%"
                                >

                                  <BarChart
                                    data={
                                      dashboardCharts
                                        .daily_by_ppe
                                    }
                                    margin={{
                                      top: 10,
                                      right: 10,
                                      left: -12,
                                      bottom: 6,
                                    }}
                                    barCategoryGap="38%"
                                  >

                                    <CartesianGrid
                                      stroke={chartGrid}
                                      strokeDasharray="3 7"
                                      vertical={false}
                                    />

                                    <XAxis
                                      dataKey="date"
                                      axisLine={false}
                                      tickLine={false}
                                      tick={{
                                        fill: chartText,
                                        fontSize: 10,
                                        fontWeight: 600,
                                      }}
                                      dy={8}
                                    />

                                    <YAxis
                                      allowDecimals={false}
                                      axisLine={false}
                                      tickLine={false}
                                      tick={{
                                        fill: chartText,
                                        fontSize: 10,
                                      }}
                                    />

                                    <Tooltip
                                      cursor={{
                                        fill:
                                          theme === 'dark'
                                            ? 'rgba(255,255,255,.025)'
                                            : 'rgba(15,23,42,.025)',
                                      }}
                                      contentStyle={
                                        tooltipStyle
                                      }
                                      labelStyle={
                                        tooltipLabelStyle
                                      }
                                      itemStyle={
                                        tooltipItemStyle
                                      }
                                    />

                                    <Bar
                                      dataKey="hardhat"
                                      name="Hardhat"
                                      stackId="ppe"
                                      fill={
                                        ppeColors.hardhat
                                      }
                                      maxBarSize={34}
                                    />

                                    <Bar
                                      dataKey="vest"
                                      name="Vest"
                                      stackId="ppe"
                                      fill={
                                        ppeColors.vest
                                      }
                                      maxBarSize={34}
                                    />

                                    <Bar
                                      dataKey="mask"
                                      name="Mask"
                                      stackId="ppe"
                                      fill={
                                        ppeColors.mask
                                      }
                                      maxBarSize={34}
                                    />

                                    <Bar
                                      dataKey="gloves"
                                      name="Gloves"
                                      stackId="ppe"
                                      fill={
                                        ppeColors.gloves
                                      }
                                      maxBarSize={34}
                                      radius={[
                                        3,
                                        3,
                                        0,
                                        0,
                                      ]}
                                    />

                                  </BarChart>

                                </ResponsiveContainer>

                              </div>

                            </article>


                            {/* ================================
                                SEVERITY DONUT
                                ================================ */}

                            <article className="proChartCard">

                              <div className="proChartHeader">

                                <div>

                                  <h2>
                                    Severity distribution
                                  </h2>

                                  <p>
                                    Current incident mix by
                                    assigned risk severity.
                                  </p>

                                </div>

                              </div>


                              <div className="proDonutLayout">

                                <div className="proDonutVisual">

                                  <ResponsiveContainer
                                    width="100%"
                                    height="100%"
                                  >

                                    <PieChart>

                                      <Pie
                                        data={
                                          dashboardCharts
                                            .severity_distribution
                                        }
                                        dataKey="count"
                                        nameKey="severity"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={78}
                                        outerRadius={100}
                                        paddingAngle={2}
                                        cornerRadius={3}
                                        stroke="none"
                                        onMouseEnter={(
                                          _,
                                          index
                                        ) => {

                                          const item =
                                            dashboardCharts
                                              .severity_distribution[
                                                index
                                              ]

                                          setHoveredSeverity({
                                            label:
                                              item.severity,
                                            count:
                                              item.count,
                                          })
                                        }}
                                        onMouseLeave={() =>
                                          setHoveredSeverity(
                                            null
                                          )
                                        }
                                      >

                                        {
                                          dashboardCharts
                                            .severity_distribution
                                            .map(
                                              item => {

                                                const key =
                                                  item
                                                    .severity
                                                    .toLowerCase()

                                                return (

                                                  <Cell
                                                    key={
                                                      item.severity
                                                    }
                                                    fill={
                                                      severityColors[
                                                        key
                                                      ]
                                                      ?? '#64748b'
                                                    }
                                                  />

                                                )
                                              }
                                            )
                                        }

                                      </Pie>

                                    </PieChart>

                                  </ResponsiveContainer>


                                  <div className="proDonutCenter">

                                    <strong>
                                      {
                                        hoveredSeverity
                                          ? hoveredSeverity.count
                                          : severityTotal
                                      }
                                    </strong>

                                    <span>
                                      {
                                        hoveredSeverity
                                          ? hoveredSeverity.label
                                          : 'total'
                                      }
                                    </span>

                                  </div>

                                </div>


                                <div className="proDonutBreakdown">

                                  {
                                    dashboardCharts
                                      .severity_distribution
                                      .map(
                                        item => {

                                          const key =
                                            item
                                              .severity
                                              .toLowerCase()

                                          return (

                                            <div
                                              className="proBreakdownRow"
                                              key={item.severity}
                                            >

                                              <div className="proBreakdownLabel">

                                                <span
                                                  className="proLegendDot"
                                                  style={{
                                                    background:
                                                      severityColors[
                                                        key
                                                      ],
                                                  }}
                                                />

                                                <span>
                                                  {item.severity}
                                                </span>

                                              </div>


                                              <div className="proBreakdownValue">

                                                <strong>
                                                  {item.count}
                                                </strong>

                                                <small>
                                                  {
                                                    percent(
                                                      item.count,
                                                      severityTotal
                                                    )
                                                  }%
                                                </small>

                                              </div>

                                            </div>

                                          )
                                        }
                                      )
                                  }

                                </div>

                              </div>

                            </article>

                          </section>

                        )
                      }


                      {/* =====================================
                          INCIDENT LOOKUP
                          ===================================== */}

                      <IncidentLookup />


                      {/* =====================================
                          RECENT INCIDENTS
                          ===================================== */}

                      <section className="panel incidentsPanel">

                        <div className="panelHeader">

                          <div>

                            <h2>
                              Recent incidents
                            </h2>

                            <p className="panelDescription">
                              The 50 newest incidents. Any filter
                              searches the full incident history.
                            </p>

                          </div>

                          <span className="recordCount">
                            {displayedIncidents.length}
                            {' / '}
                            {displayedIncidentTotal}
                          </span>

                        </div>



                        <div className="incidentFilters">

                          <label className="incidentFilterField incidentDateField">

                            <span>
                              Date
                            </span>

                            <input
                              className="incidentDateInput"
                              type="date"
                              value={incidentDateFilter}
                              onChange={event => {
                                setIncidentDateFilter(
                                  event.target.value
                                )
                                setIncidentPage(0)
                              }}
                              aria-label="Filter recent incidents by date"
                            />

                          </label>


                          <label className="incidentFilterField">

                            <span>
                              Severity
                            </span>

                            <select
                              className="incidentFilterSelect"
                              value={severityFilter}
                              onChange={event => {
                                setSeverityFilter(
                                  event.target.value
                                )
                                setIncidentPage(0)
                              }}
                            >
                              <option value="all">
                                All severities
                              </option>
                              <option value="high">
                                High
                              </option>
                              <option value="medium">
                                Medium
                              </option>
                              <option value="low">
                                Low
                              </option>
                            </select>

                          </label>


                          <label className="incidentFilterField">

                            <span>
                              Violation
                            </span>

                            <select
                              className="incidentFilterSelect"
                              value={violationFilter}
                              onChange={event => {
                                setViolationFilter(
                                  event.target.value
                                )
                                setIncidentPage(0)
                              }}
                            >
                              <option value="all">
                                All violations
                              </option>

                              {
                                violationOptions.map(
                                  violation => (

                                    <option
                                      key={violation}
                                      value={violation}
                                    >
                                      {formatViolation(
                                        violation
                                      )}
                                    </option>

                                  )
                                )
                              }
                            </select>

                          </label>


                          <label className="incidentFilterField">

                            <span>
                              Status
                            </span>

                            <select
                              className="incidentFilterSelect"
                              value={statusFilter}
                              onChange={event => {
                                setStatusFilter(
                                  event.target.value
                                )
                                setIncidentPage(0)
                              }}
                            >
                              <option value="all">
                                All statuses
                              </option>
                              <option value="open">
                                Open
                              </option>
                              <option value="reviewing">
                                Reviewing
                              </option>
                              <option value="resolved">
                                Resolved
                              </option>
                              <option value="dismissed">
                                Dismissed
                              </option>
                            </select>

                          </label>


                          <button
                            type="button"
                            className="clearIncidentFilters"
                            onClick={
                              clearIncidentFilters
                            }
                            disabled={!filtersActive}
                          >
                            Clear filters
                          </button>

                        </div>


                        <div className="incidentFilterSummary">

                          <span>
                            {
                              filtersActive
                                ? (
                                  <>
                                    Showing
                                    {' '}
                                    <strong>
                                      {displayedIncidents.length}
                                    </strong>
                                    {' '}
                                    of
                                    {' '}
                                    <strong>
                                      {displayedIncidentTotal}
                                    </strong>
                                    {' '}
                                    matching historical incidents
                                  </>
                                )
                                : (
                                  <>
                                  </>
                                )
                            }
                          </span>

                          {
                            filtersActive
                            && (

                              <span className="filtersApplied">
                                Full-history filters
                              </span>

                            )
                          }

                        </div>


                        <div className="tableWrap">

                          <table className="incidentsTable">

                            <thead>
                              <tr>
                                <th>ID</th>
                                <th>Time</th>
                                <th>Violation</th>
                                <th>Severity</th>
                                <th>Confidence</th>
                                <th>Status</th>
                                <th>Action</th>
                              </tr>
                            </thead>


                            <tbody>

                              {
                                filtersActive
                                && incidentSearchLoading
                                && (

                                  <tr>

                                    <td
                                      colSpan={7}
                                      className="incidentEmptyState"
                                    >
                                      <strong>
                                        Loading incident history…
                                      </strong>
                                    </td>

                                  </tr>

                                )
                              }


                              {
                                filtersActive
                                && incidentSearchError
                                && !incidentSearchLoading
                                && (

                                  <tr>

                                    <td
                                      colSpan={7}
                                      className="incidentEmptyState"
                                    >
                                      <strong>
                                        Could not load historical incidents
                                      </strong>

                                      <span>
                                        {incidentSearchError}
                                      </span>
                                    </td>

                                  </tr>

                                )
                              }


                              {
                                !incidentSearchLoading
                                && displayedIncidents.length === 0
                                && (

                                  <tr>

                                    <td
                                      colSpan={7}
                                      className="incidentEmptyState"
                                    >

                                      <strong>
                                        No matching incidents
                                      </strong>

                                      <span>
                                        Try changing your date
                                        or filters.
                                      </span>

                                    </td>

                                  </tr>

                                )
                              }


                              {
                                !incidentSearchLoading
                                && !incidentSearchError
                                && displayedIncidents.map(
                                  incident => {

                                    const isExpanded =
                                      expandedIncidentId
                                      === incident.id

                                    return (

                                      <Fragment
                                        key={incident.id}
                                      >

                                        <tr>

                                          <td>

                                            <button
                                              className={
                                                isExpanded
                                                  ? 'incidentIdButton expanded'
                                                  : 'incidentIdButton'
                                              }
                                              onClick={() =>
                                                toggleIncidentEvidence(
                                                  incident.id
                                                )
                                              }
                                              aria-expanded={
                                                isExpanded
                                              }
                                            >
                                              #{incident.id}

                                              <span className="incidentArrow" aria-hidden="true">
                                                <svg viewBox="0 0 12 12">
                                                  <path d="M3 4.5 6 7.5 9 4.5" />
                                                </svg>
                                              </span>
                                            </button>

                                          </td>


                                          <td>
                                            {
                                              new Date(
                                                incident.detected_at
                                              )
                                                .toLocaleString()
                                            }
                                          </td>


                                          <td>
                                            <strong className="violationText">
                                              {
                                                formatViolation(
                                                  incident
                                                    .violation_type
                                                )
                                              }
                                            </strong>
                                          </td>


                                          <td>
                                            <span
                                              className={
                                                `severityBadge ${
                                                  badgeClass(
                                                    'severity',
                                                    incident.severity
                                                  )
                                                }`
                                              }
                                            >
                                              {
                                                incident
                                                  .severity
                                              }
                                            </span>
                                          </td>


                                          <td>
                                            <span className="confidenceValue">
                                              {
                                                incident.confidence
                                                == null
                                                  ? '—'
                                                  : `${Math.round(
                                                      incident.confidence
                                                      * 100
                                                    )}%`
                                              }
                                            </span>
                                          </td>


                                          <td>
                                            <span
                                              className={
                                                `statusBadge ${
                                                  badgeClass(
                                                    'status',
                                                    incident.status
                                                  )
                                                }`
                                              }
                                            >
                                              {incident.status}
                                            </span>
                                          </td>


                                          <td>

                                            <select
                                              className="incidentFilterSelect"
                                              value={
                                                incident.status
                                              }
                                              disabled={
                                                incidentStatusUpdating
                                                === incident.id
                                              }
                                              onChange={event => {
                                                const nextStatus =
                                                  event.target.value as IncidentStatus

                                                void updateIncidentStatus(
                                                  incident.id,
                                                  nextStatus
                                                )
                                              }}
                                              aria-label={
                                                `Change status for incident #${incident.id}`
                                              }
                                            >
                                              <option value="open">
                                                Open
                                              </option>
                                              <option value="reviewing">
                                                Reviewing
                                              </option>
                                              <option value="resolved">
                                                Resolved
                                              </option>
                                              <option value="dismissed">
                                                Dismissed
                                              </option>
                                            </select>

                                          </td>

                                        </tr>


                                        {
                                          isExpanded
                                          && (

                                            <tr className="evidenceRow">

                                              <td colSpan={7}>

                                                <div className="evidencePanel">

                                                  <div className="evidenceHeader">

                                                    <div>

                                                      <p className="evidenceEyebrow">
                                                        Evidence snapshot
                                                      </p>

                                                      <h3>
                                                        Incident #{incident.id}
                                                      </h3>

                                                    </div>

                                                    <button
                                                      className="closeEvidenceButton"
                                                      onClick={() =>
                                                        setExpandedIncidentId(
                                                          null
                                                        )
                                                      }
                                                    >
                                                      Close
                                                    </button>

                                                  </div>


                                                  {
                                                    evidenceErrors[
                                                      incident.id
                                                    ]
                                                      ? (

                                                        <div className="noEvidence">

                                                          <strong>
                                                            No evidence available
                                                          </strong>

                                                          <p>
                                                            This incident may
                                                            predate database
                                                            evidence storage,
                                                            have been created
                                                            manually, or its
                                                            evidence may have
                                                            fallen outside the
                                                            latest-100 retention
                                                            window.
                                                          </p>

                                                        </div>

                                                      )
                                                      : (

                                                        <img
                                                          className="evidenceImage"
                                                          src={
                                                            evidenceUrl(
                                                              incident.id
                                                            )
                                                          }
                                                          alt={
                                                            `Evidence for incident #${incident.id}`
                                                          }
                                                          loading="lazy"
                                                          onError={() =>
                                                            setEvidenceErrors(
                                                              current => ({
                                                                ...current,
                                                                [
                                                                  incident.id
                                                                ]:
                                                                  true,
                                                              })
                                                            )
                                                          }
                                                        />

                                                      )
                                                  }


                                                  <div className="evidenceDetails">

                                                    <div>
                                                      <span>
                                                        Violation
                                                      </span>

                                                      <strong>
                                                        {
                                                          formatViolation(
                                                            incident
                                                              .violation_type
                                                          )
                                                        }
                                                      </strong>
                                                    </div>

                                                    <div>
                                                      <span>
                                                        Track
                                                      </span>

                                                      <strong>
                                                        #{incident.track_id}
                                                      </strong>
                                                    </div>

                                                    <div>
                                                      <span>
                                                        Severity
                                                      </span>

                                                      <strong>
                                                        {incident.severity}
                                                      </strong>
                                                    </div>

                                                    <div>
                                                      <span>
                                                        Confidence
                                                      </span>

                                                      <strong>
                                                        {
                                                          incident.confidence
                                                          == null
                                                            ? '—'
                                                            : `${Math.round(
                                                                incident
                                                                  .confidence
                                                                * 100
                                                              )}%`
                                                        }
                                                      </strong>
                                                    </div>

                                                  </div>

                                                </div>

                                              </td>

                                            </tr>

                                          )
                                        }

                                      </Fragment>

                                    )
                                  }
                                )
                              }

                            </tbody>

                          </table>

                        </div>


                        {
                          filtersActive
                          && incidentSearchCount > 0
                          && (

                            <div className="incidentFilterSummary">

                              <button
                                type="button"
                                className="clearIncidentFilters"
                                onClick={() =>
                                  setIncidentPage(
                                    current =>
                                      Math.max(
                                        0,
                                        current - 1
                                      )
                                  )
                                }
                                disabled={
                                  incidentPage === 0
                                  || incidentSearchLoading
                                }
                              >
                                ← Previous
                              </button>

                              <span>
                                Page
                                {' '}
                                <strong>
                                  {incidentPage + 1}
                                </strong>
                                {' '}
                                of
                                {' '}
                                <strong>
                                  {incidentPageCount}
                                </strong>
                              </span>

                              <button
                                type="button"
                                className="clearIncidentFilters"
                                onClick={() =>
                                  setIncidentPage(
                                    current =>
                                      Math.min(
                                        incidentPageCount - 1,
                                        current + 1
                                      )
                                  )
                                }
                                disabled={
                                  incidentPage + 1
                                    >= incidentPageCount
                                  || incidentSearchLoading
                                }
                              >
                                Next →
                              </button>

                            </div>

                          )
                        }

                      </section>

                    </>

                  )
                }

              </>

            )
      }

      </main>

    </div>
  )
}
