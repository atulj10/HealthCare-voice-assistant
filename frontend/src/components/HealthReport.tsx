import type { HealthReport } from "../types/call";

interface HealthReportProps {
  report: HealthReport;
  onNewCall: () => void;
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 py-3 last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="text-sm text-slate-800">{value ?? "Not provided"}</dd>
    </div>
  );
}

function ListSection({
  label,
  items,
  empty,
}: {
  label: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 py-3 last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="text-sm text-slate-800">
        {items.length === 0 ? (
          <span className="text-slate-400">{empty}</span>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

const COMPLETENESS_COLORS: Record<HealthReport["informationCompleteness"], string> = {
  limited: "bg-red-100 text-red-700",
  partial: "bg-amber-100 text-amber-700",
  good: "bg-emerald-100 text-emerald-700",
};

export default function HealthReport({ report, onNewCall }: HealthReportProps) {
  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Health Screening Report</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
            COMPLETENESS_COLORS[report.informationCompleteness]
          }`}
        >
          {report.informationCompleteness} completeness
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <dl>
          <Row label="Patient Name" value={report.patientName} />
          <Row label="Main Concern" value={report.mainConcern} />
          <Row label="Duration" value={report.duration} />
          <Row label="Severity" value={report.severity} />
          <ListSection label="Key Symptoms" items={report.keySymptoms} empty="None reported" />
          <ListSection label="Follow-up" items={report.followUp} empty="None" />
          <ListSection label="Red Flags" items={report.redFlags} empty="None reported" />
          <ListSection
            label="Other Relevant Information"
            items={report.otherRelevantInformation}
            empty="None"
          />
        </dl>

        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Summary
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{report.summary}</p>
        </div>

        <p className="mt-4 text-xs text-slate-400">
          This report is a screening summary only. It is not a medical diagnosis
          and should not replace professional medical advice.
        </p>
      </div>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onNewCall}
          className="rounded-full bg-teal-600 px-8 py-3 text-lg font-semibold text-white shadow-lg transition hover:bg-teal-700"
        >
          Start New Call
        </button>
      </div>
    </div>
  );
}
