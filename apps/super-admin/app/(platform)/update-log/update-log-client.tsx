"use client";

import { useState, useMemo, type ComponentType } from "react";
import { Search, GitCommit, CheckCircle2, ShieldCheck, Bug, Sparkles, Truck, CreditCard, Filter, ArrowUpRight } from "lucide-react";
import { Input } from "@tokophi/ui/input";
import { Badge } from "@tokophi/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@tokophi/ui/card";
import { DEV_LOGS, type DevLogCategory, type DevLogSurface } from "@/lib/data/dev-logs";

const CATEGORY_MAP: Record<DevLogCategory, { label: string; badgeVariant: "default" | "secondary" | "outline" | "destructive"; icon: ComponentType<{ className?: string }> }> = {
  major: { label: "Major Release", badgeVariant: "default", icon: Sparkles },
  minor: { label: "Minor Update", badgeVariant: "secondary", icon: GitCommit },
  feature: { label: "Fitur Baru", badgeVariant: "outline", icon: Sparkles },
  bugfix: { label: "Bug Fix", badgeVariant: "destructive", icon: Bug },
  security: { label: "Keamanan & RLS", badgeVariant: "outline", icon: ShieldCheck },
  logistics_payment: { label: "Logistik & Payment", badgeVariant: "secondary", icon: Truck },
};

export function UpdateLogClient() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSurface, setSelectedSurface] = useState<string>("all");

  const filteredLogs = useMemo(() => {
    return DEV_LOGS.filter((log) => {
      const matchSearch =
        search === "" ||
        log.version.toLowerCase().includes(search.toLowerCase()) ||
        log.title.toLowerCase().includes(search.toLowerCase()) ||
        log.summary.toLowerCase().includes(search.toLowerCase()) ||
        log.problem.toLowerCase().includes(search.toLowerCase()) ||
        log.solution.toLowerCase().includes(search.toLowerCase());

      const matchCategory = selectedCategory === "all" || log.category === selectedCategory;
      const matchSurface = selectedSurface === "all" || log.surfaces.includes(selectedSurface as DevLogSurface);

      return matchSearch && matchCategory && matchSurface;
    });
  }, [search, selectedCategory, selectedSurface]);

  return (
    <div className="space-y-6 p-6">
      {/* Header section */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Update Log Development</h1>
          <p className="text-sm text-muted-foreground">
            Ringkasan log teknis & histori rilis khusus operator (human). Pahami lokasi bug, perbaikan, dan pembaruan fitur platform.
          </p>
        </div>
        <Badge variant="outline" className="w-fit px-3 py-1 text-xs font-semibold text-primary border-primary/30 bg-primary/5">
          Current Engine: v1.0.0 Stable
        </Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
              <GitCommit className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Dev Logs</p>
              <h3 className="text-xl font-bold">{DEV_LOGS.length} Catatan</h3>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-600">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Status Verifikasi</p>
              <h3 className="text-xl font-bold">100% Passed</h3>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-600">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Keamanan & RLS</p>
              <h3 className="text-xl font-bold">53 Tabel Gated</h3>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/10 p-2.5 text-purple-600">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Vitest Suite</p>
              <h3 className="text-xl font-bold">722 Tes Hijau</h3>
            </div>
          </div>
        </Card>
      </div>

      {/* Search & Filter Bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Cari log (misal: RLS, KiriminAja, bug, v1.0.0, COD)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
              <Filter className="size-3.5" /> Kategori:
            </div>
            <button
              onClick={() => setSelectedCategory("all")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedCategory === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Semua
            </button>
            {Object.entries(CATEGORY_MAP).map(([catKey, catVal]) => (
              <button
                key={catKey}
                onClick={() => setSelectedCategory(catKey)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedCategory === catKey ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {catVal.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Log Feed */}
      <div className="space-y-4">
        {filteredLogs.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">Tidak ada dev log yang cocok dengan pencarian / filter Anda.</p>
          </Card>
        ) : (
          filteredLogs.map((log) => {
            const categoryMeta = CATEGORY_MAP[log.category] || CATEGORY_MAP.minor;
            const CategoryIcon = categoryMeta.icon;

            return (
              <Card key={log.id} className="overflow-hidden border-l-4 border-l-primary">
                <CardHeader className="bg-muted/30 pb-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-sm font-bold text-primary">{log.version}</span>
                      <span className="text-xs text-muted-foreground">• {log.date}</span>
                      <Badge variant={categoryMeta.badgeVariant} className="flex items-center gap-1 text-[11px]">
                        <CategoryIcon className="size-3" /> {categoryMeta.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {log.surfaces.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px] bg-background">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <CardTitle className="mt-2 text-base font-semibold">{log.title}</CardTitle>
                  <CardDescription className="text-xs text-foreground/90 font-medium bg-background p-2.5 rounded border border-border/60">
                    💡 <span className="font-semibold">Ringkasan:</span> {log.summary}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3 p-4 text-xs">
                  <div className="grid gap-3 md:grid-cols-3">
                    {/* Problem */}
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                        <Bug className="size-3.5" /> Di mana Bug / Isu:
                      </p>
                      <p className="text-muted-foreground leading-relaxed">{log.problem}</p>
                    </div>

                    {/* Solution */}
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                      <p className="font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5 mb-1">
                        <CheckCircle2 className="size-3.5" /> Solusi & Perbaikan:
                      </p>
                      <p className="text-muted-foreground leading-relaxed">{log.solution}</p>
                    </div>

                    {/* Verification */}
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <p className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 mb-1">
                        <ShieldCheck className="size-3.5" /> Bukti Verifikasi:
                      </p>
                      <p className="text-muted-foreground leading-relaxed">{log.verification}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
