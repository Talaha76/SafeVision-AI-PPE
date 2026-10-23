# ============================================================
# SAFEVISION AI — API BENCHMARK
# ============================================================
#
# Measures backend API response times and reports mean,
# median (p50), and p95 latency across multiple requests.
#
# ============================================================

import argparse
import statistics
import time
import httpx


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    idx = min(len(ordered) - 1, round((len(ordered) - 1) * p))
    return ordered[idx]


def main(url: str, requests: int) -> None:
    samples = []
    with httpx.Client(timeout=10) as client:
        for _ in range(requests):
            start = time.perf_counter()
            response = client.get(url)
            response.raise_for_status()
            samples.append((time.perf_counter() - start) * 1000)
    print({
        "requests": requests,
        "mean_ms": round(statistics.mean(samples), 2),
        "p50_ms": round(percentile(samples, .50), 2),
        "p95_ms": round(percentile(samples, .95), 2),
    })


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://localhost:8000/api/analytics/summary")
    p.add_argument("--requests", type=int, default=100)
    a = p.parse_args()
    main(a.url, a.requests)
