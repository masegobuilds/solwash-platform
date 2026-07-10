# ☀️ Solwash DT

> **AMD Hackathon Entry**  
> *High-Performance Solar Fleet Intelligence & Automated Dispatch Platform for O&M Providers.*

🚀 **[Live Production URL](https://solwashdt-hackathon.web.app/)**  
🎬 **[Video Walkthrough & Pitch](ADD_YOUR_YOUTUBE_OR_LOOM_LINK_HERE)**

---

## 📋 Table of Contents
* [Overview](#-overview)
* [Core Features](#-core-features)
* [Technical Architecture](#-technical-architecture)
* [AMD ROCm & Firebase Integration](#-amd-rocm--firebase-integration)
* [Getting Started Locally](#-getting-started-locally)
* [Authors](#-authors)

---

## 🔍 Overview

**Solwash DT** addresses a multi-billion-rand pain point in global clean energy infrastructure: **solar panel soiling**. Dust, grime, and environmental pollution cut commercial panel output by up to 41%. Despite this, legacy Operations & Maintenance (O&M) providers fly blind, relying on arbitrary calendar-based cleaning cycles or noticing generation drops only when end-of-month billing statements arrive.

Solwash DT bridges this intelligence gap by converting passive hardware telemetry into real-time, high-yield operational workflows. It computes accurate generation baselines, isolates genuine dirt accumulation from ambient weather patterns, quantifies financial loss down to the second, and bridges communication directly into active technical dispatch routing.

---

## ✨ Core Features

* **Real-Time Revenue Leak Ticker:** An interactive landing page matrix quantifying precisely how many Rands are escaping your solar assets second-by-second while the platform is open.
* **The "Cloud vs. Dirt" Diagnostic Engine:** Avoids expensive false alarms by analyzing cloud cover metrics. If local cloud cover passes a 70% threshold, weather suppression automatically silences alerts, separating natural irradiance drops from physical panel soiling.
* **One-Tap WhatsApp Technical Dispatch:** Bypasses complex, disconnected enterprise software. Instantly compiles an exact metadata payload (Inverter models, efficiency ratings, dirt confidence index, coordinates) and routes it straight into native WhatsApp templates for localized technical crews.
* **Granular Fleet Analytics:** Broken down into interactive visual sub-systems including live string diagnostics, historical 24-hour comparative charts, and automated workflow booking tools with baked-in ROI tracking metrics.

---

## 🛠️ Technical Architecture

The platform is architected for extreme high-throughput telemetry analytics, separating visual interface triggers from dense calculation logic.

* **Frontend Framework:** React 18, Vite (Fast HMR development environment), Tailwind CSS (Enterprise Dark Mode Interface)
* **Real-time Synchronization:** Google Firebase Cloud Firestore
* **Communication Layer:** Automated Deep-Linked WhatsApp Dispatch Gateway
* **Regional Optimization Baseline:** Pre-configured for South African utility constants (Bloemfontein metrics, 5.5 peak sun hours, R3.00/kWh tariff calculations).

---

## 🧠 AMD ROCm & Firebase Integration

To process multiple asynchronous string models across distributed geographical grids, Solwash DT relies on data models built for speed:

1. **The AMD ROCm Pipeline:** Accelerates the background regression algorithms and peer-outlier models. By offloading local performance metric variations and peer-benchmarking arrays to AMD-optimized compute pipelines, the system isolates true degradation spikes from nearby panels under identical local conditions.
2. **Firebase Cloud Firestore:** Acts as our instantaneous global state store. As the accelerated pipeline determines structural efficiency drops, it streams update fields seamlessly to collections like `site_metadata` and `panels/P-004`, updating live client view dashboards with zero structural latency.

```json
// Example of the live schema pushed through the data engine
{
  "actual_output_w": 7080,
  "capacity_kwp": 12,
  "dirt_confidence_percent": 98,
  "efficiency_percent": 59,
  "estimated_billing_zar": 2650,
  "expected_output_w": 12000,
  "inverter_model": "SolarEdge SE12000",
  "last_analyzed_timestamp": "9 July 2026 at 11:15:34 UTC+2",
  "name": "Ground Array"
}
