import { useMemo } from 'react';

const BatterySparkline = ({ history }) => {
  const points = useMemo(() => {
    try {
      const parsed = JSON.parse(history);
      if (!Array.isArray(parsed)) return [];
      const samples = parsed.filter(
        (sample) => Array.isArray(sample) && sample.length >= 2 && Number.isFinite(sample[1]),
      );
      if (samples.length < 2) return [];
      const values = samples.map((sample) => sample[1]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      return samples.map((sample, index) => ({
        x: (index / (samples.length - 1)) * 90,
        y: 22 - ((sample[1] - min) / span) * 20 - 1,
      }));
    } catch {
      return [];
    }
  }, [history]);
  if (!points.length) return null;
  return (
    <svg width="90" height="24" viewBox="0 0 90 24" aria-label="batteryHistory">
      <polyline
        points={points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="#0D47A1"
        strokeWidth="1.5"
      />
    </svg>
  );
};

export default BatterySparkline;
