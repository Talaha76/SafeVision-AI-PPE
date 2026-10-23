// ============================================================
// SAFEVISION AI — FRONTEND TYPES
// ============================================================
//
// Defines shared TypeScript types for dashboard summaries,
// incidents, trends, PPE analytics, status, and severity data.
//
// ============================================================

export type Summary = {
  incidents_today: number
  open_incidents: number
  compliance_rate: number | null
  most_common_violation: string | null
  highest_risk_location: string | null
  avg_resolution_minutes: number | null
  duplicate_reduction_pct: number | null
}


export type Trend = {
  date: string
  count: number
}


export type Incident = {
  id: number
  camera_id: number
  track_id: number
  violation_type: string
  missing_ppe: string[]
  severity: string
  confidence: number | null
  detected_at: string
  status: string
  resolved_at: string | null
  evidence_path?: string | null
}


export type PPEViolationCount = {
  ppe: string
  count: number
}


export type DailyPPEViolation = {
  date: string
  hardhat: number
  vest: number
  mask: number
  gloves: number
}


export type StatusDistribution = {
  status: string
  count: number
}


export type SeverityDistribution = {
  severity: string
  count: number
}


export type DashboardCharts = {
  weekly_by_ppe: PPEViolationCount[]

  daily_by_ppe: DailyPPEViolation[]

  status_distribution:
    StatusDistribution[]

  severity_distribution:
    SeverityDistribution[]
}