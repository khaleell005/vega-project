import "./StatCard.css";

interface StatCardProps {
  label: string;
  value: string;
  tone?: "neutral" | "safe" | "danger";
}

export default function StatCard({ label, value, tone = "neutral" }: StatCardProps) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
    </div>
  );
}
