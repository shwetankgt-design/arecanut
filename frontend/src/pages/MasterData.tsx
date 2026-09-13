import { useEffect, useState } from "react";
import { api } from "../api";

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="gt-card p-4">
      <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">{title} <span className="text-[var(--gt-text-muted)] font-normal">({items.length})</span></div>
      <div className="flex flex-wrap gap-2">
        {items.map((x) => (
          <span key={x} className="text-xs bg-[#F1EBF7] text-[var(--gt-purple-dark)] px-2.5 py-1 rounded-full">{x}</span>
        ))}
      </div>
    </div>
  );
}

export default function MasterData() {
  const [districts, setDistricts] = useState<string[]>([]);
  const [societies, setSocieties] = useState<string[]>([]);
  const [crops, setCrops] = useState<string[]>([]);
  const [schemes, setSchemes] = useState<string[]>([]);
  const [machines, setMachines] = useState<string[]>([]);

  useEffect(() => {
    api.districts().then(setDistricts);
    api.societies().then(setSocieties);
    api.crops().then(setCrops);
    api.schemes().then(setSchemes);
    api.machines().then(setMachines);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Master Data</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">Shared reference lists used across the app — govern dropdowns app-wide.</p>
      </div>
      <List title="Districts" items={districts} />
      <List title="Societies / FPCs" items={societies} />
      <List title="Other Crops" items={crops} />
      <List title="Government Schemes" items={schemes} />
      <List title="Mechanisation Equipment" items={machines} />
    </div>
  );
}
