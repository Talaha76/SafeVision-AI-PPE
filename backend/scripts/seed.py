# ============================================================
# SAFEVISION AI — DATABASE SEED
# ============================================================
#
# Creates the default demo site and camera records used for
# local development and testing.
#
# ============================================================

from app.db.models import Camera, Incident, Site
from app.db.session import SessionLocal


def main() -> None:
    db = SessionLocal()
    try:
        site = db.query(Site).filter_by(name="Demo Warehouse").first()
        if not site:
            site = Site(name="Demo Warehouse", location="Demo Site")
            db.add(site)
            db.flush()
        camera = db.query(Camera).filter_by(name="Loading Bay Camera").first()
        if not camera:
            camera = Camera(
                site_id=site.id,
                name="Loading Bay Camera",
                zone="loading_bay",
                stream_source="../ml/sample_data/demo.mp4",
                active=True,
            )
            db.add(camera)
        db.commit()
        print(f"Seeded site_id={site.id}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
