-- Learning/reference schema. The application itself uses Alembic migrations.
CREATE TABLE sites (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  location VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cameras (
  id SERIAL PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  zone VARCHAR(80) NOT NULL DEFAULT 'general',
  stream_source VARCHAR(500) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE incidents (
  id SERIAL PRIMARY KEY,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL,
  violation_type VARCHAR(120) NOT NULL,
  missing_ppe JSONB NOT NULL,
  severity VARCHAR(20) NOT NULL,
  confidence DOUBLE PRECISION,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  evidence_path VARCHAR(500)
);

CREATE TABLE compliance_observations (
  id SERIAL PRIMARY KEY,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL,
  is_compliant BOOLEAN NOT NULL,
  missing_ppe JSONB NOT NULL,
  missing_count INTEGER NOT NULL DEFAULT 0,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE detection_events (
  id SERIAL PRIMARY KEY,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  track_id INTEGER,
  class_name VARCHAR(80) NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
