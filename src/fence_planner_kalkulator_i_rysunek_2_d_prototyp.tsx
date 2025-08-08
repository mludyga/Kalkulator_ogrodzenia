"use client";

import React, { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Ruler, Layout, Calculator, RefreshCw, Map, Bug } from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";
// ESM build z domyślnym eksportem funkcji
import svg2pdf from "svg2pdf.js";

// --- Helpers ---
const mmPerUnit: Record<string, number> = { mm: 1, cm: 10, m: 1000 };
const toMM = (value: number | string, unit: string) => Number(value || 0) * (mmPerUnit[unit] || 1);
const fromMM = (value: number, unit: string) => Number(value || 0) / (mmPerUnit[unit] || 1);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const format = (n: number, unit = "mm", digits = 0) => `${fromMM(n, unit).toFixed(digits)} ${unit}`;

// Types
type SectionName = "front" | "right" | "back" | "left";
type PlinthSystem = "beton" | "ceownik";

interface SectionCfg {
  name: SectionName;
  enabled: boolean;
  length: number; // w bieżącej jednostce
  system: PlinthSystem;
}

// --- Main component ---
export default function FencePlanner() {
  const [unit, setUnit] = useState("m");
  const [inputs, setInputs] = useState({
    panelW: 2.5, // m
    panelH: 1.5, // m
    panelType: "3D" as "2D" | "3D",
    corrugations: undefined as number | undefined, // obejmy na słupek
    postWidth: 0.06, // m
    footing: 0.2, // m
    minGap: 0.005, // 5 mm
    maxGap: 0.02, // 20 mm
  });

  // Działka – 4 boki
  const [sections, setSections] = useState<SectionCfg[]>([
    { name: "front", enabled: true, length: 10, system: "beton" },
    { name: "right", enabled: true, length: 15, system: "beton" },
    { name: "back", enabled: true, length: 10, system: "beton" },
    { name: "left", enabled: true, length: 15, system: "beton" },
  ]);

  // Brama/furtka przypisane do konkretnego boku
  const [gate, setGate] = useState({
    enabled: true,
    section: "front" as SectionName,
    width: 4,
    height: 1.6,
    offset: 3,
  });
  const [wicket, setWicket] = useState({
    enabled: true,
    section: "front" as SectionName,
    width: 1,
    height: 1.6,
    offset: 8,
  });

  // Dev: szybki wynik testów
  const [testReport, setTestReport] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const setInput = (key: keyof typeof inputs) => (e: any) => {
    const value = Number(e?.target?.value ?? e);
    setInputs((s) => ({ ...s, [key]: isNaN(value) ? (e?.target?.value ?? e) : value }));
  };

  const setSection = (idx: number, patch: Partial<SectionCfg>) => {
    setSections((arr) => arr.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const mm = useMemo(() => {
    const u = unit;
    return {
      panelW: toMM(inputs.panelW, u),
      panelH: toMM(inputs.panelH, u),
      postWidth: toMM(inputs.postWidth, u),
      footing: toMM(inputs.footing, u),
      minGap: toMM(inputs.minGap, u),
      maxGap: toMM(inputs.maxGap, u),
      sections: sections.map((s) => ({ ...s, length: toMM(s.length, u) })),
      gate: {
        ...gate,
        width: toMM(gate.width, u),
        height: toMM(gate.height, u),
        offset: toMM(gate.offset, u),
      },
      wicket: {
        ...wicket,
        width: toMM(wicket.width, u),
        height: toMM(wicket.height, u),
        offset: toMM(wicket.offset, u),
      },
    };
  }, [unit, inputs, sections, gate, wicket]);

  // mapowanie przetłoczeń (tymczasowe pewniaki)
  const autoCorrForH = (hmm: number) => {
    const rounded = Math.round(hmm / 10) * 10;
    const map: Record<number, number | undefined> = { 830: 2, 2230: 4, 2430: 4 };
    return map[rounded];
  };

  const result = useMemo(() => {
    const corr = Number.isFinite(inputs.corrugations as any)
      ? (inputs.corrugations as number)
      : (autoCorrForH(mm.panelH) ?? 0);

    const calcOne = (lengthMM: number, withGate: boolean, withWicket: boolean) => {
      // rezerwacja elementów specjalnych
      let reserved = 0;
      if (withGate) reserved += mm.gate.width;
      if (withWicket) reserved += mm.wicket.width;
      const available = Math.max(0, lengthMM - reserved);

      const Wp = mm.panelW;
      const minGap = mm.minGap;
      const maxGap = mm.maxGap;

      let n = Math.max(1, Math.floor(available / (Wp + minGap)));
      const trySolve = (nTry: number) => {
        if (nTry <= 0) return null;
        if (nTry === 1) return { n: 1, gap: 0 };
        const gap = (available - nTry * Wp) / (nTry - 1);
        if (gap >= minGap && gap <= maxGap) return { n: nTry, gap };
        return null;
      };
      let solved = trySolve(n) || trySolve(n + 1) || trySolve(n - 1) || null;
      let gap: number;
      if (!solved) {
        n = Math.max(1, Math.round(available / Wp));
        gap = (available - n * Wp) / Math.max(1, n - 1);
        gap = clamp(gap, minGap, maxGap);
      } else {
        n = solved.n;
        gap = solved.gap;
      }

      const postsLinear = n + 1; // słupki liniowe (bez rogów)
      const plinths = n; // panele = płyty
      const lengthUsed = available + reserved;
      return { nPanels: n, gap, postsLinear, plinths, lengthUsed };
    };

    // policz sekcje
    const active = mm.sections.filter((s) => s.enabled && (s as any).length > 0);
    const order: SectionName[] = ["front", "right", "back", "left"];
    const inOrder = order
      .map((name) => active.find((s) => s.name === name))
      .filter(Boolean) as Array<SectionCfg & { length: number }>;

    const perSection: any[] = [];
    inOrder.forEach((s) => {
      const hasGate = gate.enabled && gate.section === s.name;
      const hasWicket = wicket.enabled && wicket.section === s.name;
      const r = calcOne((s as any).length, hasGate, hasWicket);
      perSection.push({ name: s.name, system: s.system, ...r });
    });

    // narożniki (pomiędzy sąsiadami w kolejności front→right→back→left→front)
    let corners = 0;
    for (let i = 0; i < order.length; i++) {
      const a = mm.sections.find((s) => s.name === order[i])!;
      const b = mm.sections.find((s) => s.name === order[(i + 1) % order.length])!;
      if (a.enabled && (a as any).length > 0 && b.enabled && (b as any).length > 0) corners++;
    }

    // suma słupków + narożne
    const postsLinearSum = perSection.reduce((acc, s) => acc + s.postsLinear, 0);
    const totalPosts = postsLinearSum + corners;

    // obejmy
    const clampsPerPost = corr;
    const totalClamps = clampsPerPost * totalPosts;
    const cornerClamps = clampsPerPost * corners;

    // łączniki narożne podmurówki
    const cornerBeton = inOrder.length ? countCornersBySystem(mm.sections as any, "beton") : 0;
    const cornerCeownik = inOrder.length ? countCornersBySystem(mm.sections as any, "ceownik") : 0;

    return {
      nPanels: perSection.reduce((a, s) => a + s.nPanels, 0),
      plinths: perSection.reduce((a, s) => a + s.plinths, 0),
      posts: totalPosts,
      corners,
      clampsPerPost,
      totalClamps,
      cornerClamps,
      cornerBeton,
      cornerCeownik,
      perSection,
      totalLength: perSection.reduce((a, s) => a + s.lengthUsed, 0),
    };
  }, [mm, gate, wicket, inputs.corrugations, inputs.panelType]);

  function countCornersBySystem(sectionsArr: SectionCfg[], sys: PlinthSystem) {
    const order: SectionName[] = ["front", "right", "back", "left"];
    let c = 0;
    for (let i = 0; i < order.length; i++) {
      const a = sectionsArr.find((s) => s.name === order[i])!;
      const b = sectionsArr.find((s) => s.name === order[(i + 1) % order.length])!;
      if (a.enabled && a.length > 0 && b.enabled && b.length > 0) {
        if (a.system === sys || b.system === sys) c++;
      }
    }
    return c;
  }

  // --- Exporters ---
  const downloadSVG = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ogrodzenie_schemat.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildBOM = () => {
    const u = unit;
    const it: Array<{ name: string; qty: number; details: string }> = [];

    // sumy globalne
    it.push({
      name: "Panel ogrodzeniowy",
      qty: result.nPanels,
      details: `typ ${inputs.panelType}, szer. ${format(mm.panelW, u, 2)}, wys. ${format(mm.panelH, u, 2)}`,
    });
    it.push({
      name: "Słupek",
      qty: result.posts,
      details: `przekrój ${format(mm.postWidth, u, 3)} × ${format(mm.postWidth, u, 3)}`,
    });

    // akcesoria
    if (result.clampsPerPost > 0) {
      it.push({
        name: "Obejma montażowa (prosta)",
        qty: result.totalClamps - result.cornerClamps,
        details: `${result.clampsPerPost} szt / słupek liniowy`,
      });
      it.push({
        name: "Obejma montażowa (rogowa)",
        qty: result.cornerClamps,
        details: `${result.clampsPerPost} szt / słupek narożny`,
      });
    }

    // podmurówka – 1 płyta pod panel
    it.push({
      name: "Podmurówka prefab.",
      qty: result.plinths,
      details: `pod panelem: ${format(mm.panelW, u, 2)} × wys. ${format(mm.footing, u, 2)}`,
    });

    // łączniki narożne
    if (result.cornerBeton > 0)
      it.push({ name: "Łącznik betonowy narożny", qty: result.cornerBeton, details: `dla płyt 2450 mm` });
    if (result.cornerCeownik > 0)
      it.push({ name: "Ceownik narożny (do weryfikacji)", qty: result.cornerCeownik, details: `dla płyt 2500 mm` });

    // brama / furtka
    if (gate.enabled)
      it.push({
        name: "Brama",
        qty: 1,
        details: `bok: ${gate.section}, szer. ${format(mm.gate.width, u, 2)}, wys. ${format(mm.gate.height, u, 2)}`,
      });
    if (wicket.enabled)
      it.push({
        name: "Furtka",
        qty: 1,
        details: `bok: ${wicket.section}, szer. ${format(mm.wicket.width, u, 2)}, wys. ${format(mm.wicket.height, u, 2)}`,
      });

    return { items: it };
  };

  const downloadPDF = async () => {
  const svg = svgRef.current as SVGSVGElement | null;
  if (!svg) return;

  // dynamiczny import tylko w przeglądarce
  const mod: any = await import("svg2pdf.js");
  const svg2pdf = mod.default || mod; // obsłuż obie formy eksportu

  const bbox = svg.getBBox();
  const doc = new jsPDF({
    orientation: bbox.width > bbox.height ? "l" : "p",
    unit: "mm",
    format: "a4",
  });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const scale = Math.min((pageW - 20) / bbox.width, (pageH - 40) / bbox.height);
  const opts = { x: 10, y: 20, width: bbox.width * scale, height: bbox.height * scale } as any;

  if (typeof svg2pdf !== "function") {
    console.error("svg2pdf nie jest funkcją:", svg2pdf);
    alert("Nie udało się załadować svg2pdf. Sprawdź paczkę svg2pdf.js.");
    return;
  }
  svg2pdf(svg, doc as any, opts);

  const bom = buildBOM();
  const rows = bom.items.map((i) => [i.name, i.qty, i.details]);
  doc.text("Zestawienie materiałów", 10, pageH - 70);
  (doc as any).autoTable({
    startY: pageH - 65,
    head: [["Element", "Ilość", "Szczegóły"]],
    body: rows,
    styles: { fontSize: 9 },
  });

  doc.save("ogrodzenie.pdf");
};

  const downloadCSV = () => {
    const bom = buildBOM();
    const lines = ["Element;Ilosc;Szczegoly"];
    bom.items.forEach((i) => {
      const line = `${i.name};${i.qty};${i.details.replace(/;/g, ",")}`;
      lines.push(line);
    });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zestawienie_materialow.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Rysunek wieloodcinkowy ---
  const svg = useMemo(() => {
    const PAD = 20; // px
    const VIEW_W = 1000; // px
    const active = sections.filter((s) => s.enabled && s.length > 0);
    const totalMM = active.reduce((a, s) => a + toMM(s.length, unit), 0);
    const scaleX = totalMM > 0 ? (VIEW_W - 2 * PAD) / totalMM : 1;

    const lineY = 140; // baseline
    const heightScale = 300 / Math.max(mm.panelH, mm.gate.height, mm.wicket.height, mm.footing + mm.panelH);

    const elems: any[] = [];

    const order: SectionName[] = ["front", "right", "back", "left"];
    const inOrder = order
      .map((name) => active.find((s) => s.name === name))
      .filter(Boolean) as SectionCfg[];

    // rysuj odcinki + narożniki
    let cursor = PAD;
    inOrder.forEach((s, idx) => {
      const w = toMM(s.length, unit) * scaleX;
      const label = labelForSection(s.name);
      // baseline
      elems.push(<line key={`sec-${s.name}`} x1={cursor} y1={lineY} x2={cursor + w} y2={lineY} strokeWidth={2} stroke="black" />);
      // etykieta boku
      elems.push(
        <text key={`label-${s.name}`} x={cursor + w / 2} y={lineY + 16} textAnchor="middle" fontSize={12}>
          {label}
        </text>
      );
      // obrys panelu (wysokość umowna)
      const h = mm.panelH * heightScale;
      elems.push(<rect key={`rect-${s.name}`} x={cursor} y={lineY - h} width={w} height={h} fill="none" stroke="black" strokeWidth={1} />);
      // znacznik systemu podmurówki
      elems.push(
        <text key={`sys-${s.name}`} x={cursor + w / 2} y={lineY - h - 6} textAnchor="middle" fontSize={10}>
          {s.system === "beton" ? "Łącznik betonowy (2450)" : "Ceownik (2500)"}
        </text>
      );

      // narożnik po prawej (jeśli kolejny odcinek istnieje lub domykamy do pierwszego)
      const next = inOrder[(idx + 1) % inOrder.length];
      if (next) {
        const x = cursor + w;
        elems.push(<circle key={`corner-${s.name}`} cx={x} cy={lineY} r={3} fill="black" />);
      }

      cursor += w;
    });

    return (
      <svg ref={svgRef} width={VIEW_W} height={260} viewBox={`0 0 ${VIEW_W} 260`}>
        {elems}
      </svg>
    );
  }, [sections, unit, mm]);

  function labelForSection(name: SectionName) {
    switch (name) {
      case "front":
        return "Front";
      case "right":
        return "Prawa";
      case "back":
        return "Tył";
      case "left":
        return "Lewa";
    }
  }

  // Presety – szybkie przyciski
  const setPreset = (which: "frontOnly" | "frontRight" | "frontLeft" | "all") => {
    if (which === "frontOnly") setSections((s) => s.map((b) => ({ ...b, enabled: b.name === "front" })));
    if (which === "frontRight") setSections((s) => s.map((b) => ({ ...b, enabled: b.name === "front" || b.name === "right" })));
    if (which === "frontLeft") setSections((s) => s.map((b) => ({ ...b, enabled: b.name === "front" || b.name === "left" })));
    if (which === "all") setSections((s) => s.map((b) => ({ ...b, enabled: true })));
  };

  // --- Minimalne testy runtime ---
  const runSelfTests = () => {
    const results: string[] = [];
    results.push(typeof svg2pdf === "function" ? "PASS: svg2pdf is a function" : `FAIL: svg2pdf typeof=${typeof svg2pdf}`);
    const bom = buildBOM();
    const nonNeg = bom.items.every((i) => typeof i.qty === "number" && i.qty >= 0);
    results.push(nonNeg ? "PASS: BOM quantities non-negative" : "FAIL: Negative qty in BOM");
    setTestReport(results.join("\n"));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <motion.h1 className="text-2xl font-semibold flex items-center gap-2">
        <Layout className="w-6 h-6" /> Planer ogrodzeń – kalkulator i rysunek 2D
      </motion.h1>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* GLOBAL */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" /> Parametry ogólne
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="col-span-2">
              <Label>Jednostka</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mm">mm</SelectItem>
                  <SelectItem value="cm">cm</SelectItem>
                  <SelectItem value="m">m</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Label>Typ panelu</Label>
              <Select value={inputs.panelType} onValueChange={setInput("panelType") as any}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3D">3D (z przetłoczeniami)</SelectItem>
                  <SelectItem value="2D">2D (bez przetłoczeń)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <NumberField label="Szerokość panela" value={inputs.panelW as any} onChange={setInput("panelW")} unit={unit} />
            <NumberField label="Wysokość panela" value={inputs.panelH as any} onChange={setInput("panelH")} unit={unit} />
            <NumberField label="Szerokość słupka" value={inputs.postWidth as any} onChange={setInput("postWidth")} unit={unit} />
            <NumberField label="Wys. podmurówki" value={inputs.footing as any} onChange={setInput("footing")} unit={unit} />

            <div className="col-span-2 border-t pt-2">
              <Label className="flex items-center gap-2">
                <Ruler className="w-4 h-4" /> Przerwy (luz montażowy)
              </Label>
            </div>
            <NumberField label="Min. przerwa" value={inputs.minGap as any} onChange={setInput("minGap")} unit={unit} />
            <NumberField label="Maks. przerwa" value={inputs.maxGap as any} onChange={setInput("maxGap")} unit={unit} />

            <div className="col-span-2 border-t pt-2">
              <Label>Akcesoria / obejmy</Label>
            </div>
            <NumberField
              label="Liczba przetłoczeń (= obejm na słupek)"
              value={(inputs.corrugations as number) ?? ("" as any)}
              onChange={setInput("corrugations")}
              unit={"szt"}
            />
            <p className="col-span-2 text-xs text-muted-foreground">
              Dla 2D przyjmujemy liczbę obejm jak w 3D o tej samej wysokości. Tymczasowo: 830→2; 2230/2430→4 (pozostałe do uzupełnienia).
            </p>
          </CardContent>
        </Card>

        {/* WYNIKI SUMARYCZNE */}
        <Card>
          <CardHeader>
            <CardTitle>Wyniki – całość działki</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <KV label="Panele (łącznie)">{result.nPanels}</KV>
            <KV label="Słupki (łącznie)">{result.posts}</KV>
            <KV label="Podmurówki (łącznie)">{result.plinths}</KV>
            <KV label="Narożniki aktywne">{result.corners}</KV>
            <KV label="Obejmy proste">{result.totalClamps - result.cornerClamps} szt</KV>
            <KV label="Obejmy rogowe">{result.cornerClamps} szt</KV>
            <KV label="Łącznik narożny (beton)">{result.cornerBeton}</KV>
            <KV label="Ceownik narożny (do weryfikacji)">{result.cornerCeownik}</KV>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => window.location.reload()} variant="outline" className="gap-2">
                <RefreshCw className="w-4 h-4" /> Reset
              </Button>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={downloadSVG} className="gap-2">
                <Download className="w-4 h-4" /> SVG
              </Button>
              <Button onClick={() => void downloadPDF()} variant="secondary" className="gap-2">
                <Download className="w-4 h-4" /> PDF
              </Button>
              <Button onClick={downloadCSV} variant="secondary" className="gap-2">
                <Download className="w-4 h-4" /> CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SEKCJA: BOKI DZIAŁKI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Map className="w-5 h-5" /> Boki działki
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreset("frontOnly")}>Tylko front</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("frontRight")}>Front + prawa</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("frontLeft")}>Front + lewa</Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("all")}>Wszystkie</Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {sections.map((s, i) => (
              <div key={s.name} className={`border rounded-md p-3 space-y-2 ${s.enabled ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between">
                  <Label className="font-medium">{labelForSection(s.name)}</Label>
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => setSection(i, { enabled: e.target.checked })} />
                    wlicz
                  </label>
                </div>

                <NumberField
                  label="Długość"
                  value={s.length as any}
                  onChange={(v: any) => setSection(i, { length: Number(v?.target?.value ?? v) })}
                  unit={unit}
                />

                <div>
                  <Label>System podmurówki</Label>
                  <Select value={s.system} onValueChange={(val) => setSection(i, { system: val as PlinthSystem })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beton">Łącznik betonowy (płyta 2450)</SelectItem>
                      <SelectItem value="ceownik">Ceownik metalowy (płyta 2500)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* SEKCJA: BRAMA I FURTKA */}
      <Card>
        <CardHeader>
          <CardTitle>Bramy i furtki (przypisanie do boków)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Brama</Label>
              <label className="text-xs flex items-center gap-1">
                <input type="checkbox" checked={gate.enabled} onChange={(e) => setGate({ ...gate, enabled: e.target.checked })} />
                wlicz
              </label>
            </div>

            <div>
              <Label>Bok</Label>
              <Select value={gate.section} onValueChange={(val) => setGate({ ...gate, section: val as SectionName })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="front">Front</SelectItem>
                  <SelectItem value="right">Prawa</SelectItem>
                  <SelectItem value="back">Tył</SelectItem>
                  <SelectItem value="left">Lewa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <NumberField label="Szerokość" value={gate.width as any} onChange={(v: any) => setGate({ ...gate, width: Number(v?.target?.value ?? v) })} unit={unit} />
            <NumberField label="Wysokość" value={gate.height as any} onChange={(v: any) => setGate({ ...gate, height: Number(v?.target?.value ?? v) })} unit={unit} />
            <NumberField label="Pozycja od początku boku" value={gate.offset as any} onChange={(v: any) => setGate({ ...gate, offset: Number(v?.target?.value ?? v) })} unit={unit} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="font-medium">Furtka</Label>
              <label className="text-xs flex items-center gap-1">
                <input type="checkbox" checked={wicket.enabled} onChange={(e) => setWicket({ ...wicket, enabled: e.target.checked })} />
                wlicz
              </label>
            </div>

            <div>
              <Label>Bok</Label>
              <Select value={wicket.section} onValueChange={(val) => setWicket({ ...wicket, section: val as SectionName })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="front">Front</SelectItem>
                  <SelectItem value="right">Prawa</SelectItem>
                  <SelectItem value="back">Tył</SelectItem>
                  <SelectItem value="left">Lewa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <NumberField label="Szerokość" value={wicket.width as any} onChange={(v: any) => setWicket({ ...wicket, width: Number(v?.target?.value ?? v) })} unit={unit} />
            <NumberField label="Wysokość" value={wicket.height as any} onChange={(v: any) => setWicket({ ...wicket, height: Number(v?.target?.value ?? v) })} unit={unit} />
            <NumberField label="Pozycja od początku boku" value={wicket.offset as any} onChange={(v: any) => setWicket({ ...wicket, offset: Number(v?.target?.value ?? v) })} unit={unit} />
          </div>
        </CardContent>
      </Card>

      {/* RYSUNEK */}
      <Card>
        <CardHeader>
          <CardTitle>Rysunek techniczny (schemat)</CardTitle>
        </CardHeader>
        <CardContent>{svg}</CardContent>
      </Card>

      {/* Testy / diagnostyka */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="w-5 h-5" /> Testy (runtime)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" size="sm" onClick={runSelfTests}>Uruchom testy</Button>
          {testReport && (
            <pre className="text-xs bg-muted p-2 rounded-md whitespace-pre-wrap">{testReport}</pre>
          )}
          <p className="text-xs text-muted-foreground">
            Te szybkie testy sprawdzają import svg2pdf i podstawy BOM bez negatywnych ilości.
          </p>
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardHeader>
          <CardTitle>Założenia i uwagi</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <ul className="list-disc pl-5 space-y-1">
            <li>Obejmy na słupek = liczba przetłoczeń (dla 2D przyjmujemy liczbę jak w 3D tej samej wysokości).</li>
            <li>Narożnik liczymy, gdy dwa sąsiednie boki są włączone i mają dodatnią długość.</li>
            <li>Łączniki narożne: dla systemu „Łącznik betonowy (2450)” liczymy 1:1; dla „Ceownik (2500)” – pozycja do weryfikacji.</li>
            <li>Brama/furtka przypisane do konkretnego boku – ich szerokość rezerwuje miejsce w długości tego boku.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Helpery pod komponentem ----
function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: any) => void;
  unit: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input type="number" step="any" value={value as any} onChange={onChange} className="w-full" />
        <span className="text-sm text-muted-foreground w-10 text-right">{unit}</span>
      </div>
    </div>
  );
}
