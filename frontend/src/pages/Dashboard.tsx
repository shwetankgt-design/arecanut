import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { api } from "../api";
import { useLang } from "../LangContext";
import { tr, trDistrict } from "../i18n";
import YieldEstimator from "../components/YieldEstimator";

const COLORS = ["#5A2D82", "#A6266E", "#F0AB00", "#8B5FB0", "#1E8E5A", "#C4304A", "#3E1F5C"];

function KpiCard({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) {
  return (
    <div
      className={`gt-card p-4 flex flex-col gap-1 transition-shadow ${onClick ? "cursor-pointer hover:shadow-md hover:border-[var(--gt-purple-light)]" : ""}`}
      onClick={onClick}
    >
      <div className="text-[12px] font-semibold text-[var(--gt-text-muted)] uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-[var(--gt-purple-dark)]">{value}</div>
      {sub && <div className="text-[11px] text-[var(--gt-text-muted)]">{sub}</div>}
    </div>
  );
}

function Section({ title, children, lang }: { title: string; children: React.ReactNode; lang: string }) {
  return (
    <div className="gt-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm text-[var(--gt-purple-dark)]">{title}</div>
        <div className="text-[10px] text-[var(--gt-text-muted)]">{tr("drillHint", lang as any)}</div>
      </div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const navigate = useNavigate();
  const { lang } = useLang();

  useEffect(() => {
    api.dashboardKpis().then(setData).catch(console.error);
  }, []);

  if (!data) return <div className="text-center py-20 text-[var(--gt-text-muted)]">Loading dashboard…</div>;

  const goto = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    navigate(`/farmers${qs ? `?${qs}` : ""}`);
  };

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyData = monthNames.map((mo) => ({ month: mo, qtl: Math.round(data.market_access.monthly_yield[mo] || 0) }));
  const districtData = data.reach.district_counts.map(([name, count]: any) => ({ name: trDistrict(name, lang), rawName: name, count }));
  const channelData = data.market_access.channel_share.map(([name, value]: any) => ({ name, value }));
  const creditSourceData = data.financial_inclusion.credit_source_share.map(([name, value]: any) => ({ name, value }));
  const challengeData = data.advisory_targeting.challenge_share.map(([name, value]: any) => ({ name, value }));
  const irrigationData = data.sustainability.irrigation_share.map(([name, value]: any) => ({ name, value }));
  const saleTypeData = data.economics.sale_type_share.map(([name, value]: any) => ({ name, value }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">{tr("dashboardTitle", lang)}</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">{tr("dashboardSubtitle", lang)}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Farmers Surveyed" value={data.total_farmers} sub="Total records" onClick={() => goto({})} />
        <KpiCard label="Society / FPC Linked" value={`${data.institutional_linkage.pct_society_linked}%`} onClick={() => goto({ society_assoc: "Yes" })} />
        <KpiCard label="Avg. Net Income" value={`₹${data.economics.avg_net_income.toLocaleString("en-IN")}`} sub="per farmer / season" onClick={() => goto({})} />
        <KpiCard label="Avg. Yield / Acre" value={`${data.land_productivity.avg_yield_per_acre} Qtl`} onClick={() => goto({})} />
        <KpiCard label="Credit Linked" value={`${data.financial_inclusion.pct_credit_linked}%`} onClick={() => goto({ credit_linkage: "Yes" })} />
        <KpiCard label="Govt. Scheme Availed" value={`${data.scheme_penetration.pct_scheme_availed}%`} onClick={() => goto({ scheme_availed: "Yes" })} />
        <KpiCard label="Soil Test Done" value={`${data.sustainability.pct_soil_test_done}%`} onClick={() => goto({ soil_test_done: "Yes" })} />
        <KpiCard label="Crop Insured" value={`${data.risk_management.pct_crop_insurance}%`} onClick={() => goto({ crop_insurance: "Yes" })} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <YieldEstimator />

        <Section title="District-wise Coverage" lang={lang}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={districtData} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar
                dataKey="count"
                fill="#5A2D82"
                radius={[0, 6, 6, 0]}
                cursor="pointer"
                onClick={(d: any) => goto({ district: d.payload?.rawName ?? d.rawName })}
              />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Seasonality of Sales (Qtl by Month)" lang={lang}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="qtl"
                stroke="#A6266E"
                strokeWidth={2.5}
                dot={{ r: 3, cursor: "pointer" }}
                activeDot={{
                  r: 5,
                  cursor: "pointer",
                  onClick: (_: any, payload: any) => goto({ sale_month: payload.payload.month }),
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Marketing Channel Share" lang={lang}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={channelData} dataKey="value" nameKey="name" outerRadius={80} label cursor="pointer" onClick={(d: any) => goto({ marketing_channel: d.payload?.name ?? d.name })}>
                {channelData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Raw vs Processed Sale Share" lang={lang}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={saleTypeData} dataKey="value" nameKey="name" outerRadius={80} label cursor="pointer" onClick={(d: any) => goto({ sale_type: d.payload?.name ?? d.name })}>
                {saleTypeData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Credit Source Mix" lang={lang}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={creditSourceData}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#F0AB00" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d: any) => goto({ credit_source: d.payload?.name ?? d.name, credit_linkage: "Yes" })} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Irrigation Source Mix" lang={lang}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={irrigationData}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#8B5FB0" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d: any) => goto({ irrigation_source: d.payload?.name ?? d.name })} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title="Top Cultivation Challenges" lang={lang}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={challengeData} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={130} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#C4304A" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d: any) => goto({ cultivation_challenges: d.payload?.name ?? d.name })} />
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <div className="gt-card p-4">
          <div className="font-semibold text-sm mb-3 text-[var(--gt-purple-dark)]">Data Quality — Audit Flags</div>
          <div className="flex flex-col gap-2 justify-center h-[220px]">
            <div className="text-sm">Entries missing GPS or Photo: <b>{data.audit.missing_geo_or_photo}</b> / {data.total_farmers}</div>
            <div
              className="text-sm cursor-pointer hover:text-[var(--gt-purple)] w-fit"
              onClick={() => goto({})}
            >
              Crop diversification (2nd crop): <b>{data.diversification.pct_diversified}%</b>
            </div>
            <div className="text-sm">Avg. input distance: <b>{data.input_supply_chain.avg_distance_km} km</b></div>
            <div className="text-sm">Avg. storage duration: <b>{data.storage_logistics.avg_storage_duration} months</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}
