/* eslint-disable no-unused-vars */
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONFIGURATION
// No real network calls. All weather is simulated locally so this runs
// perfectly inside Claude's artifact sandbox, a phone browser, or anywhere.
// ─────────────────────────────────────────────────────────────────────────────
const LOCATION = { name: "Bloemfontein, ZA", lat: -29.1181, lng: 26.2231 };

const WEATHER_SUPPRESSION_THRESHOLD = 70;   // % cloud cover → suppress dirty alerts
const DIRT_EFFICIENCY_THRESHOLD = 85;   // % — below this on a clear day = dirt flag
const PEER_OUTLIER_DELTA = 12;   // % below group average = outlier

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — SIMULATED WEATHER PROFILES
// Two realistic Bloemfontein profiles. Toggling between them is instant in UI
// but the "fetch" still waits 1 second to mimic real network latency.
// ─────────────────────────────────────────────────────────────────────────────
const WEATHER_PROFILES = {
    sunny: {
        label: "Sunny",
        icon: "☀️",
        cloudCoverPct: 8,
        irradianceWM2: 924,
        weatherLabel: "Clear Sky",
        weatherIcon: "☀️",
        feelsLikeC: 31.4,
    },
    cloudy: {
        label: "Cloudy",
        icon: "☁️",
        cloudCoverPct: 88,
        irradianceWM2: 142,
        weatherLabel: "Overcast",
        weatherIcon: "☁️",
        feelsLikeC: 17.8,
    },
};

// Simulates an async weather fetch with realistic 1s latency
async function simulateWeatherFetch(profile) {
    await new Promise(r => setTimeout(r, 1000));
    return { ...WEATHER_PROFILES[profile], fetchedAt: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const T = {
    bg: "#0F1117",
    surface: "#161B25",
    surfaceHigh: "#1C2333",
    border: "#252D3D",
    emerald: "#10B981",
    amber: "#F59E0B",
    coral: "#F97316",
    slate: "#94A3B8",
    slateLight: "#CBD5E1",
    white: "#F1F5F9",
    blue: "#3B82F6",
    financial: "#34D399",
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — STATIC SITE DATA
// ─────────────────────────────────────────────────────────────────────────────
const SITE_META = {
    siteId: "site-001",
    installedCapacityKW: 50.0,          // 50 kW commercial rooftop system
    inverterModel: "SolarEdge SE50000",
    inverterTempC: 42.1,
    status: "ONLINE",
    tariff: 3.00,           // R3.00/kWh — Bloemfontein commercial rate
};

const PANEL_REGISTRY = [
    { id: "P-001", location: "Rooftop A", capacityKW: 8.5, inverter: "SolarEdge SE10000" },
    { id: "P-002", location: "Rooftop B", capacityKW: 9.2, inverter: "Enphase IQ8+" },
    { id: "P-003", location: "Carport", capacityKW: 7.8, inverter: "Fronius Primo 8.2" },
    { id: "P-004", location: "Ground Array", capacityKW: 12.0, inverter: "SolarEdge SE12000" },
    { id: "P-005", location: "East Wing", capacityKW: 6.4, inverter: "Enphase IQ8+" },
    { id: "P-006", location: "West Wing", capacityKW: 6.1, inverter: "Enphase IQ8+" },
];

// Per-panel soiling — 0 = spotless, 0.41 = 41% energy loss.
// P-002 (29%) and P-004 (41%) are the critical dirty panels.
const PANEL_SOIL = [0.03, 0.29, 0.02, 0.41, 0.14, 0.05];

const WASH_PRICE = 2200;              // R per panel service call (50kW commercial rate)
const PEAK_HRS = 5.5;              // Bloemfontein avg solar peak hours/day (SAURAN data)
const WHATSAPP_NUMBER = "27725711586"; // Placeholder — replace with real dispatcher number

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — DIAGNOSTIC ENGINE (pure, no I/O)
// ─────────────────────────────────────────────────────────────────────────────
function runDiagnostics(weather) {
    const { cloudCoverPct, irradianceWM2 } = weather;
    const weatherSuppression = cloudCoverPct > WEATHER_SUPPRESSION_THRESHOLD;
    const irradianceFactor = Math.min(1, irradianceWM2 / 900);
    const weatherExpected = Math.round(irradianceFactor * 100);

    const currentOutputKW = parseFloat(
        (SITE_META.installedCapacityKW * irradianceFactor *
            (1 - PANEL_SOIL.reduce((s, v) => s + v, 0) / PANEL_SOIL.length)).toFixed(1)
    );

    // First pass — per-panel numbers
    const panels = PANEL_REGISTRY.map((panel, i) => {
        const soilFactor = PANEL_SOIL[i];
        const expectedW = Math.round(panel.capacityKW * 1000 * irradianceFactor);
        const actualW = Math.round(expectedW * (1 - soilFactor));
        const efficiency = Math.round(Math.min(100, actualW / Math.max(1, expectedW) * 100));
        const soilingLoss = Math.round(soilFactor * 100);
        const drop = weatherExpected - efficiency;
        // Financial model:
        //   Daily kWh lost = panel capacity (kW) × peak sun hours × soiling fraction
        //   Monthly loss (R) = daily kWh lost × 30 days × tariff (R/kWh)
        const dailyLossKwh = panel.capacityKW * PEAK_HRS * soilFactor;
        const monthlyRecovery = Math.round(dailyLossKwh * 30 * SITE_META.tariff);
        const annualRecovery = monthlyRecovery * 12;
        const invoiceValue = WASH_PRICE + 450;    // R450 diagnostic + performance report fee
        const paybackDays = Math.round(WASH_PRICE / Math.max(1, monthlyRecovery / 30));
        return {
            ...panel, actualW, expectedW, efficiency, soilingLoss, drop, weatherExpected,
            financials: { monthlyRecovery, annualRecovery, invoiceValue, paybackDays }
        };
    });

    // Second pass — peer benchmarking + dirt detection
    const avgGroupEff = Math.round(panels.reduce((s, p) => s + p.efficiency, 0) / panels.length);
    const allPanelsDown = panels.every(p => p.efficiency < weatherExpected - 5);

    const enriched = panels.map(p => {
        const peerDelta = p.efficiency - avgGroupEff;
        let isDirt = false, confidence = 0, reasons = [];

        if (weatherSuppression) {
            reasons.push(`Cloud cover ${cloudCoverPct}% exceeds ${WEATHER_SUPPRESSION_THRESHOLD}% threshold — weather suppression active`);
        } else if (p.drop > 10 && !allPanelsDown) {
            if (peerDelta < -PEER_OUTLIER_DELTA) {
                confidence += 55;
                reasons.push("Peer outlier — neighbouring panels performing normally");
            }
            if (cloudCoverPct < 25 && p.efficiency < DIRT_EFFICIENCY_THRESHOLD) {
                confidence += 35;
                reasons.push(`Clear sky (${irradianceWM2} W/m²) — underperformance unexplained by weather`);
            }
            if (p.drop > 20) {
                confidence += 10;
                reasons.push(`${p.drop}% below weather-adjusted baseline`);
            }
            isDirt = confidence >= 50;
        } else if (allPanelsDown && cloudCoverPct > 50) {
            reasons.push("Group-wide drop — consistent with cloud cover");
        }

        const diagnosis = weatherSuppression ? "WEATHER_PROMPTED_DROP"
            : isDirt ? "SOILING_DETECTED" : "NOMINAL";

        return {
            ...p, peerDelta: Math.round(peerDelta), avgGroupEff, isDirt,
            confidence: Math.min(confidence, 98), reasons, diagnosis
        };
    });

    const siteEfficiency = Math.round(enriched.reduce((s, p) => s + p.efficiency, 0) / enriched.length);
    const avgSoilingLoss = Math.round(PANEL_SOIL.reduce((s, v) => s + v, 0) / PANEL_SOIL.length * 100);
    const dirtyCount = enriched.filter(p => p.isDirt && !weatherSuppression).length;
    const siteDiagnosis = weatherSuppression ? "WEATHER_PROMPTED_DROP"
        : dirtyCount > 0 ? "SOILING_DETECTED" : "NOMINAL";

    return {
        panels: enriched, weather,
        solar: {
            siteId: SITE_META.siteId, currentOutputKW,
            installedCapacityKW: SITE_META.installedCapacityKW,
            inverterTemperatureC: SITE_META.inverterTempC, status: SITE_META.status
        },
        analysis: {
            efficiency: siteEfficiency, soilingLoss: avgSoilingLoss,
            diagnosis: siteDiagnosis, weatherSuppression, timestamp: weather.fetchedAt
        },
        avgGroupEff, weatherSuppression,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — STATUS HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getPanelStatus(panel, weatherSuppression) {
    if (weatherSuppression && panel.efficiency < 85) return "weather";
    if (panel.isDirt && panel.efficiency < 70) return "critical";
    if (panel.isDirt) return "warning";
    if (!panel.isDirt && panel.efficiency < 85) return "weather";
    return "optimal";
}
const STATUS_CFG = {
    critical: { label: "DIRTY", color: T.coral, bg: `${T.coral}14`, border: `${T.coral}40` },
    warning: { label: "SOILED", color: T.amber, bg: `${T.amber}14`, border: `${T.amber}40` },
    weather: { label: "WEATHER", color: T.blue, bg: `${T.blue}12`, border: `${T.blue}35` },
    optimal: { label: "OPTIMAL", color: T.emerald, bg: `${T.emerald}12`, border: `${T.emerald}35` },
};
const DIAGNOSIS_MAP = {
    SOILING_DETECTED: { text: "Soiling Detected", color: T.coral },
    WEATHER_PROMPTED_DROP: { text: "Weather-Prompted Drop", color: T.blue },
    NOMINAL: { text: "Nominal Operation", color: T.emerald },
};

function fmtRand(n) { return `R${Math.round(n).toLocaleString("en-ZA")}`; }
function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
}

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP DISPATCH
// Builds the branded alert message and opens the wa.me deep link.
// Works on mobile (opens WhatsApp app) and desktop (opens WhatsApp Web).
// ─────────────────────────────────────────────────────────────────────────────
function buildWhatsAppURL(panel) {
    const statusLabel = panel.efficiency < 70 ? "CRITICAL — Soiling Detected" : "Soiling Detected";
    const message = [
        `🚨 *Solwash Intelligence Alert* 🚨`,
        ``,
        `*System:* ${LOCATION.name}`,
        `*Asset:* ${panel.location} (${panel.id})`,
        `*Inverter:* ${panel.inverter}`,
        `*Status:* ${statusLabel} (${panel.confidence}% confidence)`,
        ``,
        `*Current Efficiency:* ${panel.efficiency}% _(Loss: ${panel.soilingLoss}%)_`,
        `*Capacity:* ${panel.capacityKW} kWp`,
        ``,
        `*💸 Financial Impact*`,
        `Monthly loss: *${fmtRand(panel.financials.monthlyRecovery)}* at risk`,
        `Annual exposure: *${fmtRand(panel.financials.annualRecovery)}*`,
        `Est. service billing: *${fmtRand(panel.financials.invoiceValue)}*`,
        `ROI payback: *${panel.financials.paybackDays} days* after wash`,
        ``,
        `*🔧 Action Required*`,
        `Reply *CONFIRM* to authorize technician dispatch.`,
        `Reply *SCHEDULE* to book a specific date and time.`,
        ``,
        `_Powered by Solwash Intelligence Platform — ${LOCATION.name}_`,
    ].join("\n");

    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — SKELETON + SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Sk({ w = "100%", h = 16, r = 6, mb = 0 }) {
    return <div style={{
        width: w, height: h, borderRadius: r, marginBottom: mb,
        background: `linear-gradient(90deg,${T.surfaceHigh} 25%,${T.border} 50%,${T.surfaceHigh} 75%)`,
        backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite"
    }} />;
}

function LoadingScreen({ label = "Loading…" }) {
    return (
        <div style={{
            minHeight: "100vh", background: T.bg,
            fontFamily: "'Inter','Segoe UI',system-ui,sans-serif"
        }}>
            <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 11, background: T.surfaceHigh }} />
                    <div style={{ flex: 1 }}><Sk w="130px" h={18} mb={8} /><Sk w="200px" h={11} /></div>
                </div>
                {/* Weather toggle skeleton */}
                <Sk h={52} r={12} mb={16} />
                {/* Banner */}
                <Sk h={62} r={12} mb={16} />
                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 22 }}>
                    {[...Array(5)].map((_, i) => <Sk key={i} h={86} r={12} />)}
                </div>
                {/* Loading label */}
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 10, padding: "32px 0", color: T.slate, fontSize: 13
                }}>
                    <div style={{
                        width: 18, height: 18, border: `2px solid ${T.border}`,
                        borderTop: `2px solid ${T.emerald}`, borderRadius: "50%",
                        animation: "spin 0.8s linear infinite"
                    }} />
                    {label}
                </div>
                {/* Panel grid skeleton */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
                    {[...Array(6)].map((_, i) => (
                        <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                                <div style={{ flex: 1 }}><Sk w="55%" h={14} mb={7} /><Sk w="38%" h={11} /></div>
                                <Sk w={58} h={22} r={6} />
                            </div>
                            <Sk h={5} r={3} mb={18} />
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                                <Sk h={48} r={8} /><Sk h={48} r={8} />
                            </div>
                            <Sk w="45%" h={11} />
                        </div>
                    ))}
                </div>
            </div>
            <style>{`
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
        </div>
    );
}

function Badge({ children, color, bg, border, size = 11 }) {
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: bg, border: `1px solid ${border}`, borderRadius: 6,
            padding: "3px 9px", fontSize: size, color, fontWeight: 700,
            letterSpacing: "0.07em", whiteSpace: "nowrap"
        }}>
            {children}
        </span>
    );
}

function FinancialCard({ panel, onBook, weatherSuppression }) {
    const st = STATUS_CFG[getPanelStatus(panel, weatherSuppression)];
    const fin = panel.financials;
    const showFin = panel.isDirt && !weatherSuppression && fin.monthlyRecovery > 0;
    return (
        <div style={{ marginTop: 12, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
            {showFin && (
                <div style={{
                    background: `${T.financial}0D`, border: `1px solid ${T.financial}30`,
                    borderRadius: 8, padding: "10px 12px", marginBottom: 10
                }}>
                    <div style={{ fontSize: 9, color: T.slate, letterSpacing: "0.14em", marginBottom: 6, fontWeight: 700 }}>
                        FINANCIAL IMPACT
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                        <div>
                            <div style={{ fontSize: 9, color: T.slate }}>RECOVERABLE/MO</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: T.financial }}>
                                {fmtRand(fin.monthlyRecovery)}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 9, color: T.slate }}>EST. BILLING</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: T.white }}>{fmtRand(fin.invoiceValue)}</div>
                        </div>
                    </div>
                    <div style={{ fontSize: 10, color: T.slate }}>
                        Annual loss: <span style={{ color: T.coral, fontWeight: 600 }}>{fmtRand(fin.annualRecovery)}</span>
                        <span style={{ margin: "0 6px" }}>·</span>
                        ROI in <span style={{ color: T.financial, fontWeight: 600 }}>{fin.paybackDays}d</span>
                    </div>
                </div>
            )}

            {/* Book Wash CTA */}
            <button onClick={e => { e.stopPropagation(); onBook(panel); }} style={{
                width: "100%", background: `linear-gradient(135deg,${st.color}E6,${st.color}AA)`,
                border: "none", borderRadius: 8, color: "#fff", fontSize: 12, padding: "10px 0",
                cursor: "pointer", fontFamily: "inherit", fontWeight: 700, letterSpacing: "0.1em",
                boxShadow: `0 4px 14px ${st.color}30`, marginBottom: 8
            }}>
                {showFin ? `BOOK WASH — RECOVER ${fmtRand(fin.monthlyRecovery)}/MO` : "BOOK WASH"}
            </button>

            {/* WhatsApp Dispatch button — only shown for dirty/soiled panels */}
            {showFin && (
                <a
                    href={buildWhatsAppURL(panel)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", background: "linear-gradient(135deg,#25D366CC,#128C7ECC)",
                        border: "1px solid #25D36650", borderRadius: 8, color: "#fff",
                        fontSize: 12, padding: "9px 0", cursor: "pointer",
                        fontFamily: "inherit", fontWeight: 700, letterSpacing: "0.08em",
                        textDecoration: "none", boxSizing: "border-box",
                        boxShadow: "0 4px 14px rgba(37,211,102,0.25)",
                        transition: "opacity 0.2s",
                    }}>
                    {/* WhatsApp SVG icon */}
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.117 1.528 5.845L.057 23.25a.75.75 0 00.916.916l5.41-1.471A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.694 9.694 0 01-4.96-1.362l-.355-.212-3.684 1.001 1.001-3.684-.212-.355A9.694 9.694 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z" />
                    </svg>
                    Send WhatsApp Alert
                </a>
            )}
        </div>
    );
}

const HISTORY = Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, "0")}:00`,
    output: Math.round(2800 + Math.sin((i - 6) * 0.45) * 1400 + (i * 37 % 180)),
    wIdx: i < 6 || i > 20 ? 3 : i < 10 ? 0 : i < 14 ? 1 : 0,
}));
const H_COLORS = ["#F59E0B", "#3B82F6", "#94A3B8", "#60A5FA"];
const H_LABELS = ["☀️ Clear", "⛅ Partly Cloudy", "☁️ Overcast", "🌧️ Rainy"];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function SolwashDashboard() {
    const [livePanels, setLivePanels] = useState([]);
    const FACILITY_MANAGER_PHONE = "27821234567"; // Put your phone number here

    useEffect(() => {
        const panelsCollectionRef = collection(db, 'site_metadata', 'BFN-001', 'panels');
        const unsubscribe = onSnapshot(panelsCollectionRef, (snapshot) => {
            setLivePanels(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsubscribe();
    }, []);

    const handleWhatsAppAlert = (panelId) => {
        const targetPanel = livePanels.find(p => p.id === panelId);
        const alertDraft = targetPanel?.whatsapp_alert_draft || `System Alert: Panel ${panelId} needs attention.`;
        window.open(`https://wa.me/${FACILITY_MANAGER_PHONE}?text=${encodeURIComponent(alertDraft)}`, '_blank', 'noopener,noreferrer');
    };

    // ── Weather toggle ────────────────────────────────────────────────────────
    const [weatherMode, setWeatherMode] = useState("sunny"); // "sunny" | "cloudy"

    // ── Data state ────────────────────────────────────────────────────────────
    const [status, setStatus] = useState("loading"); // "loading"|"live"
    const [pageData, setPageData] = useState(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastFetched, setLastFetched] = useState(null);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState("panels");
    const [bookingPanel, setBookingPanel] = useState(null);
    const [bookingDate, setBookingDate] = useState("");
    const [bookingTime, setBookingTime] = useState("09:00");
    const [bookings, setBookings] = useState([]);
    const [toast, setToast] = useState(null);
    const [expandedPanel, setExpandedPanel] = useState(null);
    const [dismissed, setDismissed] = useState([]);

    // ── Core load function ────────────────────────────────────────────────────
    const loadWeather = useCallback(async (mode, isRefresh = false) => {
        if (isRefresh) setIsRefreshing(true);
        else setStatus("loading");

        const weather = await simulateWeatherFetch(mode);   // 1 second simulated latency
        const data = runDiagnostics(weather);

        setPageData(data);
        setStatus("live");
        setLastFetched(new Date());
        setDismissed([]);                                    // clear dismissed alerts on each load
        setIsRefreshing(false);
    }, []);

    // Initial load
    useEffect(() => { loadWeather(weatherMode); }, []);   // eslint-disable-line

    // ── Toggle handler — switches mode AND immediately re-runs diagnostics ───
    function handleToggle() {
        const next = weatherMode === "sunny" ? "cloudy" : "sunny";
        setWeatherMode(next);
        loadWeather(next, true);  // treat as refresh — keeps existing data visible while loading
    }

    function showToast(msg, type = "success") {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4500);
    }

    function handleBook(e) {
        e.preventDefault();
        if (!bookingDate || !bookingPanel) return;
        const fin = bookingPanel.financials;
        setBookings(b => [{
            id: Date.now(), panelId: bookingPanel.id, location: bookingPanel.location,
            date: bookingDate, time: bookingTime, confidence: bookingPanel.confidence,
            invoiceValue: fin.invoiceValue, monthlyRecovery: fin.monthlyRecovery, status: "Scheduled",
        }, ...b]);
        const loc = bookingPanel.location;
        setBookingPanel(null); setBookingDate("");
        showToast(`✓ Wash booked — ${loc} · ${fmtRand(fin.monthlyRecovery)}/mo recovery unlocked`);
    }

    // ── Render guards ─────────────────────────────────────────────────────────
    if (status === "loading") return (
        <LoadingScreen label={`Simulating ${WEATHER_PROFILES[weatherMode].label} conditions…`} />
    );

    // ── Destructure live data ─────────────────────────────────────────────────
    const { panels, solar, weather, analysis, weatherSuppression } = pageData;
    const dirtyPanels = panels.filter(p => p.isDirt && !weatherSuppression && !dismissed.includes(p.id));
    const totalRecov = dirtyPanels.reduce((s, p) => s + p.financials.monthlyRecovery, 0);
    const totalBill = dirtyPanels.reduce((s, p) => s + p.financials.invoiceValue, 0);
    const isSunny = weatherMode === "sunny";

    return (
        <div style={{
            minHeight: "100vh", background: T.bg, color: T.slateLight,
            fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", fontSize: 13
        }}>

            {/* Dot grid */}
            <div style={{
                position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
                backgroundImage: `radial-gradient(circle at 1px 1px,${T.border} 1px,transparent 0)`,
                backgroundSize: "32px 32px", opacity: 0.5
            }} />
            {/* Top glow — changes colour with weather mode */}
            <div style={{
                position: "fixed", top: -300, left: "50%", transform: "translateX(-50%)",
                width: 800, height: 500, zIndex: 0, pointerEvents: "none", transition: "all 1s ease",
                background: `radial-gradient(ellipse,${isSunny ? T.amber : T.blue}08 0%,transparent 65%)`
            }} />

            <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "20px 16px" }}>

                {/* ── HEADER ───────────────────────────────────────────────────── */}
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 18, flexWrap: "wrap", gap: 10
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{
                            width: 44, height: 44, borderRadius: 11,
                            background: `linear-gradient(135deg,${T.emerald},#059669)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 20, boxShadow: `0 0 24px ${T.emerald}40`, flexShrink: 0
                        }}>☀️</div>
                        <div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: T.white, letterSpacing: "-0.01em" }}>Solwash</div>
                            <div style={{ fontSize: 10, color: T.emerald, letterSpacing: "0.16em", fontWeight: 600 }}>
                                PANEL INTELLIGENCE PLATFORM
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {/* Data source pill */}
                        <div style={{
                            display: "flex", alignItems: "center", gap: 6,
                            background: T.surfaceHigh, border: `1px solid ${T.border}`,
                            borderRadius: 8, padding: "6px 11px"
                        }}>
                            <div style={{
                                width: 7, height: 7, borderRadius: "50%",
                                background: T.emerald, boxShadow: `0 0 7px ${T.emerald}`,
                                animation: "pulse 2s infinite"
                            }} />
                            <span style={{ fontSize: 11, color: T.slate, fontWeight: 600 }}>
                                Simulated · {LOCATION.name}
                            </span>
                        </div>

                        {lastFetched && (
                            <span style={{ fontSize: 11, color: T.slate }}>{fmtTime(lastFetched.toISOString())}</span>
                        )}

                        {/* Refresh button */}
                        <button onClick={() => loadWeather(weatherMode, true)} disabled={isRefreshing} style={{
                            display: "flex", alignItems: "center", gap: 6,
                            background: T.surfaceHigh, border: `1px solid ${T.border}`,
                            borderRadius: 8, color: isRefreshing ? T.slate : T.white,
                            fontSize: 12, padding: "7px 13px", cursor: isRefreshing ? "not-allowed" : "pointer",
                            fontFamily: "inherit", fontWeight: 600
                        }}>
                            <span style={{
                                display: "inline-block",
                                animation: isRefreshing ? "spin 0.8s linear infinite" : "none"
                            }}>↺</span>
                            {isRefreshing ? "Loading…" : "Refresh"}
                        </button>
                    </div>
                </div>

                {/* ══ WEATHER TOGGLE — the centrepiece ════════════════════════════ */}
                <div style={{
                    background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
                    padding: "14px 18px", marginBottom: 16,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexWrap: "wrap", gap: 12
                }}>

                    <div>
                        <div style={{
                            fontSize: 11, color: T.slate, fontWeight: 700,
                            letterSpacing: "0.14em", marginBottom: 4
                        }}>SIMULATE CONDITIONS</div>
                        <div style={{ fontSize: 12, color: T.slate }}>
                            {isSunny
                                ? "Clear sky · 924 W/m² · 8% cloud — dirt detection active"
                                : "Overcast · 142 W/m² · 88% cloud — weather suppression active"}
                        </div>
                    </div>

                    {/* Toggle pill */}
                    <button onClick={handleToggle} disabled={isRefreshing}
                        style={{
                            display: "flex", alignItems: "center", gap: 0,
                            background: T.surfaceHigh, border: `1px solid ${T.border}`,
                            borderRadius: 100, padding: 4, cursor: isRefreshing ? "not-allowed" : "pointer",
                            opacity: isRefreshing ? 0.6 : 1, transition: "opacity 0.2s",
                            minWidth: 220
                        }}>
                        {/* Sunny side */}
                        <div style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                            gap: 7, padding: "8px 16px", borderRadius: 100, transition: "all 0.25s",
                            background: isSunny ? `linear-gradient(135deg,${T.amber}22,${T.amber}11)` : "transparent",
                            border: isSunny ? `1px solid ${T.amber}50` : "1px solid transparent"
                        }}>
                            <span style={{ fontSize: 15 }}>☀️</span>
                            <span style={{
                                fontSize: 12, fontWeight: 700,
                                color: isSunny ? T.amber : T.slate, letterSpacing: "0.06em"
                            }}>Sunny</span>
                            {isSunny && (
                                <span style={{
                                    fontSize: 9, fontWeight: 700, color: T.amber,
                                    background: `${T.amber}20`, borderRadius: 4, padding: "1px 5px",
                                    letterSpacing: "0.1em"
                                }}>ACTIVE</span>
                            )}
                        </div>
                        {/* Cloudy side */}
                        <div style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                            gap: 7, padding: "8px 16px", borderRadius: 100, transition: "all 0.25s",
                            background: !isSunny ? `linear-gradient(135deg,${T.blue}22,${T.blue}11)` : "transparent",
                            border: !isSunny ? `1px solid ${T.blue}50` : "1px solid transparent"
                        }}>
                            <span style={{ fontSize: 15 }}>☁️</span>
                            <span style={{
                                fontSize: 12, fontWeight: 700,
                                color: !isSunny ? T.blue : T.slate, letterSpacing: "0.06em"
                            }}>Cloudy</span>
                            {!isSunny && (
                                <span style={{
                                    fontSize: 9, fontWeight: 700, color: T.blue,
                                    background: `${T.blue}20`, borderRadius: 4, padding: "1px 5px",
                                    letterSpacing: "0.1em"
                                }}>ACTIVE</span>
                            )}
                        </div>
                    </button>
                </div>

                {/* ── WEATHER SUPPRESSION BANNER ───────────────────────────────── */}
                {weatherSuppression && (
                    <div style={{
                        background: `${T.blue}0C`, border: `1px solid ${T.blue}35`,
                        borderRadius: 10, padding: "12px 16px", marginBottom: 12,
                        display: "flex", alignItems: "flex-start", gap: 12
                    }}>
                        <span style={{ fontSize: 20, flexShrink: 0 }}>☁️</span>
                        <div>
                            <div style={{ color: T.blue, fontWeight: 700, fontSize: 13, marginBottom: 3 }}>
                                Weather Suppression Active
                            </div>
                            <div style={{ fontSize: 12, color: T.slate }}>
                                Cloud cover at {weather.cloudCoverPct}% — exceeds the {WEATHER_SUPPRESSION_THRESHOLD}% threshold.
                                All panel dirty alerts suppressed. Output drop is weather-driven, not soiling.
                            </div>
                        </div>
                    </div>
                )}

                {/* ── DIRT ALERTS ──────────────────────────────────────────────── */}
                {dirtyPanels.map(p => {
                    const isCrit = getPanelStatus(p, weatherSuppression) === "critical";
                    const c = isCrit ? T.coral : T.amber;
                    return (
                        <div key={p.id} style={{
                            background: `${c}0C`, border: `1px solid ${c}35`,
                            borderRadius: 10, padding: "13px 16px", marginBottom: 10,
                            display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12
                        }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }}>
                                <div style={{
                                    width: 34, height: 34, borderRadius: 8, background: `${c}18`,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 15, flexShrink: 0
                                }}>🧠</div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{
                                        display: "flex", alignItems: "center", gap: 6,
                                        flexWrap: "wrap", marginBottom: 4
                                    }}>
                                        <span style={{ color: T.white, fontWeight: 700, fontSize: 13 }}>
                                            {p.location} ({p.id})
                                        </span>
                                        <Badge color={c} bg={`${c}18`} border={`${c}40`}>{p.confidence}% DIRT CONFIDENCE</Badge>
                                    </div>
                                    <div style={{ fontSize: 11, color: T.slate, marginBottom: 5 }}>{p.reasons[0]}</div>
                                    <Badge color={T.financial} bg={`${T.financial}12`} border={`${T.financial}35`}>
                                        Recover {fmtRand(p.financials.monthlyRecovery)}/mo
                                    </Badge>
                                </div>
                            </div>
                            <div style={{
                                display: "flex", flexDirection: "column",
                                alignItems: "flex-end", gap: 6, flexShrink: 0
                            }}>
                                <div style={{ fontSize: 11, color: T.slate }}>
                                    Billing: <span style={{ color: T.white, fontWeight: 700 }}>
                                        {fmtRand(p.financials.invoiceValue)}
                                    </span>
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button onClick={() => setBookingPanel(p)} style={{
                                        background: `linear-gradient(135deg,${c},${c}CC)`, border: "none",
                                        borderRadius: 7, color: "#fff", fontSize: 12, padding: "6px 14px",
                                        cursor: "pointer", fontFamily: "inherit", fontWeight: 700
                                    }}>Book Wash</button>
                                    <a
                                        href={buildWhatsAppURL(p)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        style={{
                                            display: "inline-flex", alignItems: "center", gap: 5,
                                            background: "linear-gradient(135deg,#25D366CC,#128C7ECC)",
                                            border: "1px solid #25D36650", borderRadius: 7,
                                            color: "#fff", fontSize: 12, padding: "6px 12px",
                                            textDecoration: "none", fontFamily: "inherit", fontWeight: 700,
                                        }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                                            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.117 1.528 5.845L.057 23.25a.75.75 0 00.916.916l5.41-1.471A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.694 9.694 0 01-4.96-1.362l-.355-.212-3.684 1.001 1.001-3.684-.212-.355A9.694 9.694 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z" />
                                        </svg>
                                        Alert
                                    </a>
                                    <button onClick={() => setDismissed(d => [...d, p.id])} style={{
                                        background: "transparent", border: `1px solid ${T.border}`,
                                        borderRadius: 7, color: T.slate, fontSize: 12, padding: "6px 9px",
                                        cursor: "pointer", fontFamily: "inherit"
                                    }}>✕</button>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* ── STAT CARDS ───────────────────────────────────────────────── */}
                <div style={{
                    display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
                    gap: 11, marginBottom: 20
                }}>
                    {[
                        { label: "Site Output", value: `${solar.currentOutputKW} kW`, icon: "⚡", color: T.emerald, sub: `of ${solar.installedCapacityKW} kW` },
                        { label: "Efficiency", value: `${analysis.efficiency}%`, icon: "📊", color: analysis.efficiency < 70 ? T.coral : analysis.efficiency < 88 ? T.amber : T.emerald, sub: "system-wide" },
                        { label: "Soiling Loss", value: `${analysis.soilingLoss}%`, icon: "🌫️", color: analysis.soilingLoss > 20 ? T.coral : T.amber, sub: "avg dirty panels" },
                        { label: "Recoverable/mo", value: fmtRand(totalRecov), icon: "💰", color: T.financial, sub: "lost revenue" },
                        { label: "Service Value", value: fmtRand(totalBill), icon: "📋", color: T.white, sub: "potential billings" },
                    ].map(c => (
                        <div key={c.label} style={{
                            background: T.surface, border: `1px solid ${T.border}`,
                            borderRadius: 12, padding: "13px 15px"
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                                <span style={{ fontSize: 15 }}>{c.icon}</span>
                                <span style={{ fontSize: 9, color: T.slate, letterSpacing: "0.09em", fontWeight: 600 }}>
                                    {c.sub.toUpperCase()}
                                </span>
                            </div>
                            <div style={{ fontSize: 19, fontWeight: 800, color: c.color }}>{c.value}</div>
                            <div style={{ fontSize: 11, color: T.slate, marginTop: 3 }}>{c.label}</div>
                        </div>
                    ))}
                </div>

                {/* ── TABS ─────────────────────────────────────────────────────── */}
                <div style={{
                    display: "flex", gap: 2, marginBottom: 16,
                    borderBottom: `1px solid ${T.border}`, overflowX: "auto"
                }}>
                    {["panels", "diagnosis", "history", "bookings"].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{
                            background: "transparent", border: "none",
                            borderBottom: activeTab === tab ? `2px solid ${T.emerald}` : "2px solid transparent",
                            color: activeTab === tab ? T.white : T.slate,
                            fontSize: 13, padding: "9px 15px", cursor: "pointer",
                            fontFamily: "inherit", fontWeight: activeTab === tab ? 700 : 500,
                            whiteSpace: "nowrap", textTransform: "capitalize", marginBottom: -1
                        }}>
                            {tab}
                        </button>
                    ))}
                </div>

                {/* ══ PANELS TAB ══════════════════════════════════════════════════ */}
                {activeTab === "panels" && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 13 }}>
                        {panels.map(panel => {
                            const stKey = getPanelStatus(panel, weatherSuppression);
                            const st = STATUS_CFG[stKey];
                            const isExp = expandedPanel === panel.id;
                            return (
                                <div key={panel.id} onClick={() => setExpandedPanel(isExp ? null : panel.id)}
                                    style={{
                                        background: T.surface,
                                        border: `1px solid ${isExp ? st.color + "55" : T.border}`,
                                        borderRadius: 14, padding: 18, cursor: "pointer", transition: "border-color 0.25s",
                                        boxShadow: isExp ? `0 0 0 1px ${st.color}18, 0 6px 20px rgba(0,0,0,0.25)` : "none"
                                    }}>

                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 13 }}>
                                        <div>
                                            <div style={{ fontSize: 14, fontWeight: 700, color: T.white }}>{panel.id}</div>
                                            <div style={{ fontSize: 12, color: T.slate, marginTop: 2 }}>{panel.location}</div>
                                            <div style={{ fontSize: 11, color: T.slate, marginTop: 1 }}>{panel.inverter}</div>
                                        </div>
                                        <Badge color={st.color} bg={st.bg} border={st.border}>{st.label}</Badge>
                                    </div>

                                    {/* Efficiency bar */}
                                    <div style={{ marginBottom: 12 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                            <span style={{ fontSize: 11, color: T.slate, fontWeight: 600 }}>Efficiency</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: st.color }}>{panel.efficiency}%</span>
                                        </div>
                                        <div style={{
                                            height: 5, background: T.surfaceHigh, borderRadius: 3,
                                            overflow: "visible", position: "relative"
                                        }}>
                                            <div style={{
                                                height: "100%", width: `${panel.efficiency}%`, borderRadius: 3,
                                                background: `linear-gradient(90deg,${st.color},${st.color}BB)`,
                                                boxShadow: `0 0 8px ${st.color}55`, transition: "width 0.8s ease"
                                            }} />
                                            <div title={`Weather baseline: ${panel.weatherExpected}%`}
                                                style={{
                                                    position: "absolute", left: `${panel.weatherExpected}%`, top: -3,
                                                    width: 2, height: 11, background: T.blue + "70", borderRadius: 1,
                                                    transform: "translateX(-50%)"
                                                }} />
                                        </div>
                                        <div style={{ fontSize: 9, color: T.blue, marginTop: 4, textAlign: "right" }}>
                                            weather baseline: {panel.weatherExpected}%
                                        </div>
                                    </div>

                                    {/* Output pills */}
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                                        {[["Actual", `${panel.actualW}W`], ["Expected", `${panel.expectedW}W`]].map(([l, v]) => (
                                            <div key={l} style={{
                                                background: T.surfaceHigh, borderRadius: 8,
                                                padding: "8px 10px", border: `1px solid ${T.border}`
                                            }}>
                                                <div style={{ fontSize: 10, color: T.slate, fontWeight: 600 }}>{l}</div>
                                                <div style={{ fontSize: 14, fontWeight: 700, color: T.white, marginTop: 2 }}>{v}</div>
                                            </div>
                                        ))}
                                    </div>

                                    <div style={{
                                        display: "flex", justifyContent: "space-between",
                                        fontSize: 12, color: T.slate
                                    }}>
                                        <span>Soiling:
                                            <span style={{
                                                color: panel.soilingLoss > 20 ? T.coral
                                                    : panel.soilingLoss > 8 ? T.amber : T.emerald,
                                                fontWeight: 700, marginLeft: 4
                                            }}>{panel.soilingLoss}%</span>
                                        </span>
                                        <span style={{ fontSize: 11 }}>{panel.capacityKW} kWp</span>
                                    </div>

                                    {/* Expanded reasoning */}
                                    {isExp && panel.reasons.length > 0 && (
                                        <div style={{
                                            marginTop: 12, padding: "11px 13px", background: T.surfaceHigh,
                                            borderRadius: 10, border: `1px solid ${T.border}`
                                        }}>
                                            <div style={{
                                                fontSize: 10, color: T.slate, fontWeight: 700,
                                                letterSpacing: "0.12em", marginBottom: 7
                                            }}>DETECTION REASONING</div>
                                            {panel.reasons.map((r, i) => (
                                                <div key={i} style={{ display: "flex", gap: 7, marginBottom: 5, fontSize: 11 }}>
                                                    <span style={{ color: T.emerald, fontWeight: 700 }}>›</span>
                                                    <span style={{ color: T.slateLight }}>{r}</span>
                                                </div>
                                            ))}
                                            <div style={{
                                                marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}`,
                                                fontSize: 11, color: T.slate
                                            }}>
                                                Peers avg: <b style={{ color: T.slateLight }}>{panel.avgGroupEff}%</b>
                                                &nbsp;·&nbsp; This panel:
                                                <b style={{ color: panel.peerDelta < -10 ? T.coral : T.emerald, marginLeft: 4 }}>
                                                    {panel.peerDelta > 0 ? "+" : ""}{panel.peerDelta}% vs peers
                                                </b>
                                            </div>
                                        </div>
                                    )}

                                    {panel.isDirt && !weatherSuppression && (
                                        <FinancialCard panel={panel} onBook={setBookingPanel}
                                            weatherSuppression={weatherSuppression} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ══ DIAGNOSIS TAB ════════════════════════════════════════════════ */}
                {activeTab === "diagnosis" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>

                        {/* Snapshot */}
                        <div style={{
                            background: T.surface, border: `1px solid ${T.border}`,
                            borderRadius: 12, padding: "16px 18px"
                        }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: T.white, marginBottom: 12 }}>
                                🌤️ Simulated Weather Snapshot — {LOCATION.name}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
                                {[
                                    ["Cloud Cover", `${weather.cloudCoverPct}%`, weather.cloudCoverPct > 70 ? T.blue : T.emerald],
                                    ["Irradiance", `${weather.irradianceWM2} W/m²`, T.amber],
                                    ["Conditions", weather.weatherLabel, T.white],
                                    ["Suppression", weatherSuppression ? "ACTIVE" : "INACTIVE", weatherSuppression ? T.blue : T.emerald],
                                    ["Mode", isSunny ? "☀️ Sunny" : "☁️ Cloudy", isSunny ? T.amber : T.blue],
                                ].map(([l, v, c]) => (
                                    <div key={l} style={{
                                        background: T.surfaceHigh, borderRadius: 9,
                                        padding: "11px 13px", border: `1px solid ${T.border}`
                                    }}>
                                        <div style={{ fontSize: 10, color: T.slate, fontWeight: 600, marginBottom: 4 }}>
                                            {l.toUpperCase()}
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{v}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Engine rules */}
                        <div style={{
                            background: `${T.emerald}0A`, border: `1px solid ${T.emerald}25`,
                            borderRadius: 12, padding: "16px 18px"
                        }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: T.white, marginBottom: 12 }}>
                                🧠 Cloud vs. Dirt Engine
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
                                {[
                                    { icon: "☁️", title: "Suppression Rule", desc: `Cloud cover > ${WEATHER_SUPPRESSION_THRESHOLD}% → all alerts suppressed. Now: ${weather.cloudCoverPct}% → ${weatherSuppression ? "✓ ACTIVE" : "✗ INACTIVE"}.` },
                                    { icon: "☀️", title: "Clear-Sky Dirt Check", desc: `Cloud < 25% + efficiency < ${DIRT_EFFICIENCY_THRESHOLD}% → dirt flag. Now: ${weather.cloudCoverPct < 25 ? "sky is clear, checking panels" : "sky too cloudy to evaluate"}.` },
                                    { icon: "👥", title: "Peer Benchmarking", desc: `Group avg: ${pageData.avgGroupEff}%. Panels >${PEER_OUTLIER_DELTA}% below average are flagged as outliers.` },
                                    { icon: "🎯", title: "Confidence Scoring", desc: `Peer delta + clear-sky check + drop severity → confidence score. Alert fires at ≥50%.` },
                                ].map(c => (
                                    <div key={c.title} style={{
                                        background: T.surfaceHigh, borderRadius: 9,
                                        padding: "12px 13px", border: `1px solid ${T.border}`
                                    }}>
                                        <div style={{ fontSize: 16, marginBottom: 5 }}>{c.icon}</div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: T.white, marginBottom: 3 }}>{c.title}</div>
                                        <div style={{ fontSize: 11, color: T.slate, lineHeight: 1.6 }}>{c.desc}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Panel table */}
                        <div style={{
                            background: T.surface, border: `1px solid ${T.border}`,
                            borderRadius: 12, overflow: "hidden"
                        }}>
                            <div style={{
                                padding: "12px 18px", borderBottom: `1px solid ${T.border}`,
                                fontSize: 11, color: T.slate, fontWeight: 700, letterSpacing: "0.13em"
                            }}>
                                PANEL DIAGNOSIS TABLE
                            </div>
                            <div style={{ overflowX: "auto" }}>
                                {panels.map((p, i) => {
                                    const st = STATUS_CFG[getPanelStatus(p, weatherSuppression)];
                                    return (
                                        <div key={p.id} style={{
                                            padding: "12px 18px",
                                            borderBottom: i < panels.length - 1 ? `1px solid ${T.border}` : "none",
                                            display: "grid",
                                            gridTemplateColumns: "80px 80px 1fr 70px 90px 110px",
                                            alignItems: "center", gap: 10, minWidth: 580
                                        }}>
                                            <div>
                                                <div style={{ fontSize: 12, fontWeight: 700, color: T.white }}>{p.id}</div>
                                                <div style={{ fontSize: 11, color: T.slate }}>{p.location}</div>
                                            </div>
                                            <Badge color={st.color} bg={st.bg} border={st.border} size={10}>{st.label}</Badge>
                                            <div style={{ fontSize: 11, color: T.slate }}>
                                                {weatherSuppression ? "Weather suppression active"
                                                    : p.isDirt ? p.reasons[0]
                                                        : p.efficiency >= 90 ? "Operating optimally" : "No significant soiling"}
                                            </div>
                                            <div style={{ textAlign: "right" }}>
                                                <div style={{
                                                    fontSize: 12, fontWeight: 700,
                                                    color: p.peerDelta < -12 ? T.coral : p.peerDelta > 5 ? T.emerald : T.slateLight
                                                }}>
                                                    {p.peerDelta > 0 ? "+" : ""}{p.peerDelta}%
                                                </div>
                                                <div style={{ fontSize: 10, color: T.slate }}>vs peers</div>
                                            </div>
                                            <div style={{ textAlign: "right" }}>
                                                {p.isDirt && !weatherSuppression
                                                    ? <Badge size={10}
                                                        color={p.confidence > 80 ? T.coral : T.amber}
                                                        bg={`${p.confidence > 80 ? T.coral : T.amber}14`}
                                                        border={`${p.confidence > 80 ? T.coral : T.amber}40`}>
                                                        {p.confidence}%
                                                    </Badge>
                                                    : <span style={{ fontSize: 11, color: T.slate }}>—</span>}
                                            </div>
                                            <div style={{ textAlign: "right" }}>
                                                {p.isDirt && !weatherSuppression
                                                    ? <div>
                                                        <div style={{ fontSize: 12, fontWeight: 700, color: T.financial }}>
                                                            {fmtRand(p.financials.monthlyRecovery)}/mo
                                                        </div>
                                                        <div style={{ fontSize: 10, color: T.slate }}>recoverable</div>
                                                    </div>
                                                    : <span style={{ fontSize: 11, color: T.slate }}>—</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* ══ HISTORY TAB ══════════════════════════════════════════════════ */}
                {activeTab === "history" && (
                    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.white, marginBottom: 16 }}>24-Hour Output History</div>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 130 }}>
                            {HISTORY.map((h, i) => {
                                const wc = H_COLORS[h.wIdx];
                                const pct = Math.max(0.04, (h.output - 600) / 2800);
                                return (
                                    <div key={i} style={{
                                        flex: 1, display: "flex", flexDirection: "column",
                                        alignItems: "center", height: "100%"
                                    }}>
                                        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
                                            <div style={{
                                                width: "100%", height: `${pct * 100}%`,
                                                borderRadius: "2px 2px 0 0",
                                                background: `linear-gradient(180deg,${wc}CC,${wc}55)`
                                            }} />
                                        </div>
                                        {i % 4 === 0 && <div style={{ fontSize: 8, color: T.slate, marginTop: 4 }}>{h.hour}</div>}
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                            {H_LABELS.map((l, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    <div style={{ width: 9, height: 9, borderRadius: 2, background: H_COLORS[i] }} />
                                    <span style={{ fontSize: 11, color: T.slate }}>{l}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{
                            display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))",
                            gap: 11, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.border}`
                        }}>
                            {[
                                ["Peak Output", `${Math.max(...HISTORY.map(h => h.output))}W`, T.emerald],
                                ["Avg Output", `${Math.round(HISTORY.reduce((s, h) => s + h.output, 0) / HISTORY.length)}W`, T.white],
                                ["Daily Total", `${(HISTORY.reduce((s, h) => s + h.output, 0) / 1000).toFixed(1)} kWh`, T.white],
                            ].map(([l, v, c]) => (
                                <div key={l} style={{
                                    background: T.surfaceHigh, borderRadius: 9,
                                    padding: "12px 13px", border: `1px solid ${T.border}`
                                }}>
                                    <div style={{ fontSize: 11, color: T.slate, fontWeight: 600 }}>{l}</div>
                                    <div style={{ fontSize: 19, fontWeight: 800, color: c, marginTop: 3 }}>{v}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ══ BOOKINGS TAB ═════════════════════════════════════════════════ */}
                {activeTab === "bookings" && (
                    <div>
                        {bookings.length === 0 ? (
                            <div style={{
                                background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
                                padding: 44, textAlign: "center"
                            }}>
                                <div style={{ fontSize: 30, marginBottom: 10 }}>🧹</div>
                                <div style={{ fontSize: 13, color: T.slate, fontWeight: 600 }}>No washes scheduled</div>
                                <div style={{ fontSize: 12, color: T.slate, marginTop: 5, opacity: 0.6 }}>
                                    Switch to Sunny mode — dirty panels will appear for booking
                                </div>
                            </div>
                        ) : (
                            <>
                                <div style={{
                                    background: `${T.financial}0D`, border: `1px solid ${T.financial}30`,
                                    borderRadius: 10, padding: "11px 16px", marginBottom: 11,
                                    display: "flex", justifyContent: "space-between", alignItems: "center",
                                    flexWrap: "wrap", gap: 8
                                }}>
                                    <span style={{ fontSize: 12, color: T.slate }}>
                                        {bookings.length} wash{bookings.length > 1 ? "es" : ""} scheduled
                                    </span>
                                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: T.white }}>
                                            Billings: <span style={{ color: T.financial }}>
                                                {fmtRand(bookings.reduce((s, b) => s + (b.invoiceValue || 0), 0))}
                                            </span>
                                        </span>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: T.white }}>
                                            Recovery: <span style={{ color: T.financial }}>
                                                {fmtRand(bookings.reduce((s, b) => s + (b.monthlyRecovery || 0), 0))}/mo
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {bookings.map(b => (
                                        <div key={b.id} style={{
                                            background: T.surface, border: `1px solid ${T.border}`,
                                            borderRadius: 10, padding: "13px 16px",
                                            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10
                                        }}>
                                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                                <div style={{
                                                    width: 34, height: 34, borderRadius: 8, background: T.surfaceHigh,
                                                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15
                                                }}>🧹</div>
                                                <div>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: T.white }}>
                                                        {b.location} <span style={{ color: T.slate, fontSize: 11 }}>({b.panelId})</span>
                                                    </div>
                                                    <div style={{ fontSize: 11, color: T.slate, marginTop: 2 }}>{b.date} at {b.time}</div>
                                                    {b.confidence > 0 && (
                                                        <div style={{ fontSize: 10, color: T.amber, marginTop: 2 }}>
                                                            {b.confidence}% dirt confidence
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                                                {b.invoiceValue > 0 && (
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: T.financial, marginBottom: 4 }}>
                                                        {fmtRand(b.invoiceValue)}
                                                    </div>
                                                )}
                                                <Badge color={T.emerald} bg={`${T.emerald}12`} border={`${T.emerald}35`}>
                                                    {b.status}
                                                </Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ── BOOKING MODAL ──────────────────────────────────────────────────── */}
            {bookingPanel && (() => {
                const fin = bookingPanel.financials;
                const st = STATUS_CFG[getPanelStatus(bookingPanel, weatherSuppression)];
                return (
                    <div onClick={() => setBookingPanel(null)} style={{
                        position: "fixed", inset: 0,
                        background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center",
                        justifyContent: "center", zIndex: 100, backdropFilter: "blur(6px)", padding: 16
                    }}>
                        <div onClick={e => e.stopPropagation()} style={{
                            background: T.surface,
                            border: `1px solid ${T.border}`, borderRadius: 16, padding: 24,
                            width: "100%", maxWidth: 420, boxShadow: "0 24px 64px rgba(0,0,0,0.6)"
                        }}>

                            <div style={{ fontSize: 20, marginBottom: 5 }}>🧹</div>
                            <div style={{ fontSize: 17, fontWeight: 800, color: T.white, marginBottom: 3 }}>Schedule Wash</div>
                            <div style={{ fontSize: 12, color: T.slate, marginBottom: 14 }}>
                                {bookingPanel.location} ({bookingPanel.id}) · {bookingPanel.efficiency}% efficiency
                            </div>

                            <div style={{
                                background: `${T.financial}0D`, border: `1px solid ${T.financial}30`,
                                borderRadius: 10, padding: "13px 15px", marginBottom: 16
                            }}>
                                <div style={{
                                    fontSize: 10, color: T.slate, fontWeight: 700,
                                    letterSpacing: "0.12em", marginBottom: 9
                                }}>FINANCIAL SUMMARY</div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                                    {[
                                        ["Est. Billing", fmtRand(fin.invoiceValue), T.white],
                                        ["Recovery/mo", fmtRand(fin.monthlyRecovery), T.financial],
                                        ["Payback", `${fin.paybackDays}d`, T.emerald],
                                    ].map(([l, v, c]) => (
                                        <div key={l}>
                                            <div style={{ fontSize: 9, color: T.slate, letterSpacing: "0.1em" }}>{l.toUpperCase()}</div>
                                            <div style={{ fontSize: 14, fontWeight: 700, color: c, marginTop: 2 }}>{v}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ fontSize: 11, color: T.slate, marginTop: 9 }}>
                                    Annual loss if unwashed: <span style={{ color: T.coral, fontWeight: 600 }}>
                                        {fmtRand(fin.annualRecovery)}
                                    </span>
                                </div>
                            </div>

                            <div style={{ marginBottom: 12 }}>
                                <label style={{
                                    fontSize: 11, color: T.slate, fontWeight: 600,
                                    display: "block", marginBottom: 6
                                }}>Date</label>
                                <input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)}
                                    style={{
                                        width: "100%", background: T.surfaceHigh, border: `1px solid ${T.border}`,
                                        borderRadius: 9, color: T.white, fontSize: 13, padding: "10px 13px",
                                        fontFamily: "inherit", outline: "none", boxSizing: "border-box"
                                    }} />
                            </div>

                            <div style={{ marginBottom: 18 }}>
                                <label style={{
                                    fontSize: 11, color: T.slate, fontWeight: 600,
                                    display: "block", marginBottom: 6
                                }}>Time Slot</label>
                                <select value={bookingTime} onChange={e => setBookingTime(e.target.value)}
                                    style={{
                                        width: "100%", background: T.surfaceHigh, border: `1px solid ${T.border}`,
                                        borderRadius: 9, color: T.white, fontSize: 13, padding: "10px 13px",
                                        fontFamily: "inherit", outline: "none", boxSizing: "border-box"
                                    }}>
                                    {["07:00", "08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"].map(t => (
                                        <option key={t} value={t} style={{ background: T.surface }}>{t}</option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ display: "flex", gap: 9 }}>
                                <button onClick={() => setBookingPanel(null)} style={{
                                    flex: 1, background: "transparent",
                                    border: `1px solid ${T.border}`, borderRadius: 9, color: T.slate, fontSize: 13,
                                    padding: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600
                                }}>Cancel</button>
                                <button onClick={handleBook} style={{
                                    flex: 2,
                                    background: `linear-gradient(135deg,${T.emerald},#059669)`,
                                    border: "none", borderRadius: 9, color: "#fff", fontSize: 13, padding: 12,
                                    cursor: "pointer", fontFamily: "inherit", fontWeight: 700,
                                    boxShadow: `0 4px 16px ${T.emerald}40`
                                }}>
                                    Confirm — {fmtRand(fin.invoiceValue)}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ── TOAST ──────────────────────────────────────────────────────────── */}
            {toast && (
                <div style={{
                    position: "fixed", bottom: 22, right: 14, left: 14, zIndex: 200,
                    background: T.surface,
                    border: `1px solid ${toast.type === "error" ? T.coral + "50" : T.emerald + "40"}`,
                    borderRadius: 12, padding: "13px 17px", fontSize: 13,
                    color: toast.type === "error" ? T.coral : T.white,
                    fontWeight: 600, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    maxWidth: 460, margin: "0 auto"
                }}>
                    {toast.msg}
                </div>
            )}

            <style>{`
        @keyframes pulse   { 0%,100%{opacity:1}   50%{opacity:0.4} }
        @keyframes spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        input[type="date"]::-webkit-calendar-picker-indicator { filter:invert(0.4) brightness(1.5); }
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-thumb { background:${T.border}; border-radius:3px; }
        button:hover:not(:disabled) { opacity:0.86; }
      `}</style>
        </div>
    );
}