from __future__ import annotations

import platform
import subprocess
from functools import lru_cache

# Thresholds below which DeepSeek-OCR-2 (a multi-GB transformer) isn't worth
# preferring over the OS-native/ONNX tier -- undersized VRAM means constant
# swapping/OOM, not just "slower."
MIN_CUDA_VRAM_GB = 8.0
MIN_MAC_UNIFIED_MEMORY_GB = 16.0


@lru_cache
def detect_nvidia_vram_gb() -> float | None:
    """Total VRAM (GB) of the most capable NVIDIA GPU, via `nvidia-smi` --
    authoritative and simple for the CUDA-specific question (unlike
    server/src/ingest/hardwareWorkers.ts's Windows-registry VRAM detector,
    which exists to work around WMI's 32-bit AdapterRAM field for *any* GPU
    vendor; nvidia-smi reports real values directly and works cross-platform,
    so there's no equivalent wraparound bug to route around here). Returns
    None if nvidia-smi isn't on PATH (no NVIDIA driver installed) or reports
    nothing parseable -- callers treat that as "no usable NVIDIA GPU."
    """
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None

    mib_values = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            mib_values.append(float(line))
        except ValueError:
            continue

    if not mib_values:
        return None
    return max(mib_values) / 1024


@lru_cache
def detect_mac_unified_memory_gb() -> float | None:
    """Total unified memory (GB) on Apple Silicon -- there's no separate VRAM
    pool to query on a Mac; CPU, GPU, and Neural Engine all share this same
    pool, so total system memory is the right capability signal for whether
    an MPS-backed model comfortably fits."""
    if platform.system() != "Darwin":
        return None
    try:
        result = subprocess.run(
            ["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None
    try:
        return int(result.stdout.strip()) / (1024**3)
    except ValueError:
        return None


def cuda_capable() -> bool:
    vram_gb = detect_nvidia_vram_gb()
    return vram_gb is not None and vram_gb >= MIN_CUDA_VRAM_GB


def mps_capable() -> bool:
    memory_gb = detect_mac_unified_memory_gb()
    return memory_gb is not None and memory_gb >= MIN_MAC_UNIFIED_MEMORY_GB
