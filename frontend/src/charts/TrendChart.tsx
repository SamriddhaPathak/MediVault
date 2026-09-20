import React from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export interface TrendPoint {
  date: string;
  value: number;
  unit?: string | null;
  confidence?: number | null;
  referenceRangeText?: string | null;
}

export default function TrendChart({ testName, unit, points }: { testName: string; unit?: string; points: TrendPoint[] }) {
  const data = {
    labels: points.map((p) => new Date(p.date).toLocaleDateString()),
    datasets: [
      {
        label: unit ? `${testName} (${unit})` : testName,
        data: points.map((p) => p.value),
        borderColor: "#17856a",
        backgroundColor: "#aeead4",
        tension: 0.25,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  return (
    <Line
      data={data}
      options={{
        responsive: true,
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              afterLabel: (context) => {
                const point = points[context.dataIndex];
                const details = [`Recorded: ${new Date(point.date).toLocaleDateString()}`];
                if (point.referenceRangeText) details.push(`Reference: ${point.referenceRangeText}`);
                if (point.confidence != null) details.push(`OCR confidence: ${Math.round(point.confidence * 100)}%`);
                return details;
              },
            },
          },
        },
        scales: { y: { title: { display: !!unit, text: unit ?? "" } } },
      }}
    />
  );
}
