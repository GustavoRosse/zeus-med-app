"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { calcNextDate, daysToNext, statusFromDays, IntervalUnit } from "@/lib/schedule";

import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  format,
} from "date-fns";

type PetRow = { id: string; name: string };
type PetMemberRow = { role: "owner" | "viewer" };

type TreatmentRow = {
  id: string;
  pet_id: string;
  category: string;
  name: string;
  interval_value: number;
  interval_unit: IntervalUnit; // "days" | "months"
  alerts_days: number[];
};

type ApplicationRow = { applied_on: string }; // YYYY-MM-DD

type AgendaItem = {
  treatmentId: string;
  treatmentName: string;
  category: string;
  lastAppliedOn: string | null;
  nextDate: Date | null;
  daysToNext: number | null;
};

function fmtDateBR(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

function isoDateLocal(d: Date) {
  // YYYY-MM-DD (local)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function weekdayShortPt(i: number) {
  // semana começa na segunda (pt-BR)
  const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  return labels[i];
}

export default function AgendaPage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<"owner" | "viewer" | null>(null);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // calendário
  const [calMonth, setCalMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  // modal marcar aplicação
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTreatmentId, setModalTreatmentId] = useState<string | null>(null);
  const [modalTreatmentName, setModalTreatmentName] = useState<string>("");
  const [modalDate, setModalDate] = useState<string>(""); // YYYY-MM-DD
  const [saving, setSaving] = useState(false);

  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        window.location.href = "/login";
        return;
      }
      setEmail(sessionData.session.user.email ?? "");

      const { data: pets, error: petsErr } = await supabase
        .from("pets")
        .select("id,name")
        .eq("name", "Zeus")
        .limit(1);

      if (petsErr) {
        setError(`Erro ao buscar pet: ${petsErr.message}`);
        setLoading(false);
        return;
      }
      if (!pets || pets.length === 0) {
        setError('Pet "Zeus" não encontrado (ou você não tem acesso via RLS).');
        setLoading(false);
        return;
      }

      const zeus: PetRow = pets[0];

      const userId = sessionData.session.user.id;
      const { data: member, error: memberErr } = await supabase
        .from("pet_members")
        .select("role")
        .eq("pet_id", zeus.id)
        .eq("user_id", userId)
        .limit(1);

      if (memberErr) {
        setError(`Erro ao buscar role: ${memberErr.message}`);
        setLoading(false);
        return;
      }
      if (!member || member.length === 0) {
        setError("Você não está cadastrado em pet_members para o Zeus.");
        setLoading(false);
        return;
      }

      const myRole = (member[0] as PetMemberRow).role;
      setRole(myRole);

      const { data: treatments, error: trErr } = await supabase
        .from("treatments")
        .select("id,pet_id,category,name,interval_value,interval_unit,alerts_days")
        .eq("pet_id", zeus.id)
        .order("category", { ascending: true })
        .order("name", { ascending: true });

      if (trErr) {
        setError(`Erro ao buscar tratamentos: ${trErr.message}`);
        setLoading(false);
        return;
      }

      const trRows: TreatmentRow[] = (treatments ?? []) as TreatmentRow[];

      const agenda: AgendaItem[] = [];
      for (const t of trRows) {
        const { data: apps, error: appErr } = await supabase
          .from("applications")
          .select("applied_on")
          .eq("treatment_id", t.id)
          .order("applied_on", { ascending: false })
          .limit(1);

        if (appErr) {
          setError(`Erro ao buscar aplicações (${t.name}): ${appErr.message}`);
          setLoading(false);
          return;
        }

        const lastAppliedOn = apps && apps.length > 0 ? (apps[0] as ApplicationRow).applied_on : null;

        let nextDate: Date | null = null;
        let dtn: number | null = null;

        if (lastAppliedOn) {
          const last = new Date(`${lastAppliedOn}T00:00:00`);
          nextDate = calcNextDate(last, t.interval_value, t.interval_unit);
          dtn = daysToNext(nextDate, today);
        }

        agenda.push({
          treatmentId: t.id,
          treatmentName: t.name,
          category: t.category,
          lastAppliedOn,
          nextDate,
          daysToNext: dtn,
        });
      }

      agenda.sort((a, b) => (a.daysToNext ?? 999999) - (b.daysToNext ?? 999999));

      setItems(agenda);

      const firstNext = agenda.find((x) => x.nextDate)?.nextDate;
      if (firstNext) {
        setCalMonth(firstNext);
        setSelectedDay(firstNext);
      }

      setLoading(false);
    })();
  }, [today]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function openMarkModal(treatmentId: string, treatmentName: string, suggestedDate?: Date) {
    if (role !== "owner") return;

    setModalTreatmentId(treatmentId);
    setModalTreatmentName(treatmentName);

    const d = suggestedDate ?? new Date();
    setModalDate(isoDateLocal(d));

    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setIsModalOpen(false);
    setModalTreatmentId(null);
    setModalTreatmentName("");
    setModalDate("");
  }

  async function saveApplication() {
    if (role !== "owner") return;
    if (!modalTreatmentId) return;

    if (!modalDate) {
      alert("Selecione uma data.");
      return;
    }

    setSaving(true);

    const { error: insErr } = await supabase.from("applications").insert([
      {
        treatment_id: modalTreatmentId,
        applied_on: modalDate, // YYYY-MM-DD
      },
    ]);

    setSaving(false);

    if (insErr) {
      alert(`Erro ao salvar: ${insErr.message}`);
      return;
    }

    closeModal();
    window.location.reload();
  }

  const noHistory = items.filter((x) => x.lastAppliedOn === null);
  const overdue = items.filter((x) => x.daysToNext !== null && statusFromDays(x.daysToNext) === "overdue");
  const upcoming60 = items.filter((x) => x.daysToNext !== null && statusFromDays(x.daysToNext) === "upcoming");

  // calendário: agrupar itens por dia + contagem por status
  const eventsByDay = useMemo(() => {
    const map = new Map<
      string,
      {
        items: AgendaItem[];
        overdueCount: number;
        upcomingCount: number;
        total: number;
      }
    >();

    for (const it of items) {
      if (!it.nextDate) continue;

      const key = isoDateLocal(it.nextDate);

      const entry =
        map.get(key) ??
        ({
          items: [],
          overdueCount: 0,
          upcomingCount: 0,
          total: 0,
        } as {
          items: AgendaItem[];
          overdueCount: number;
          upcomingCount: number;
          total: number;
        });

      entry.items.push(it);
      entry.total += 1;

      if (it.daysToNext !== null) {
        const st = statusFromDays(it.daysToNext);
        if (st === "overdue") entry.overdueCount += 1;
        if (st === "upcoming") entry.upcomingCount += 1;
      }

      map.set(key, entry);
    }

    for (const [k, entry] of map.entries()) {
      entry.items.sort((a, b) => a.treatmentName.localeCompare(b.treatmentName));
      map.set(k, entry);
    }

    return map;
  }, [items]);

  const selectedKey = isoDateLocal(selectedDay);
  const selectedEntry = eventsByDay.get(selectedKey);
  const selectedEvents = selectedEntry?.items ?? [];

  if (loading) return <div className="p-6">Carregando...</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Agenda — Zeus</h1>
          <p className="text-sm text-gray-600">
            Logado como: {email} {role ? `(${role})` : ""}
          </p>
        </div>

        {/* ✅ BOTÕES HEADER (Config + Sair) */}
        <div className="flex items-center gap-2">
          <a className="rounded-md border px-3 py-1" href="/config">
            Config
          </a>
          <button className="rounded-md border px-3 py-1" onClick={logout}>
            Sair
          </button>
        </div>
      </div>

      {/* Errors */}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {/* ✅ CALENDÁRIO */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Calendário</h2>

        <div className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <button className="rounded-md border px-3 py-1" onClick={() => setCalMonth(subMonths(calMonth, 1))}>
                ◀
              </button>

              <button
                className="rounded-md border px-3 py-1"
                onClick={() => {
                  const d = new Date();
                  setCalMonth(d);
                  setSelectedDay(d);
                }}
              >
                Hoje
              </button>
            </div>

            <div className="font-medium">{format(calMonth, "MMMM yyyy")}</div>

            <button className="rounded-md border px-3 py-1" onClick={() => setCalMonth(addMonths(calMonth, 1))}>
              ▶
            </button>
          </div>

          {/* Legenda */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-400">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span> Atrasado
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-500"></span> Próximo (≤ 60d)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-500"></span> Outros
            </span>
          </div>

          {/* Cabeçalho dias da semana (Seg..Dom) */}
          <div className="grid grid-cols-7 gap-2 text-xs text-gray-500">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="text-center">
                {weekdayShortPt(i)}
              </div>
            ))}
          </div>

          {/* Grade do mês */}
          <div className="grid grid-cols-7 gap-2">
            {(() => {
              const monthStart = startOfMonth(calMonth);
              const monthEnd = endOfMonth(calMonth);

              const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
              const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

              const cells: any[] = [];
              let day = gridStart;

              while (day <= gridEnd) {
                const cellDate = new Date(day.getTime()); // ✅ evita bug do click

                const inMonth = isSameMonth(cellDate, calMonth);
                const isSelected = isSameDay(cellDate, selectedDay);
                const isToday = isSameDay(cellDate, new Date());

                const key = isoDateLocal(cellDate);
                const entry = eventsByDay.get(key);
                const overdueCount = entry?.overdueCount ?? 0;
                const upcomingCount = entry?.upcomingCount ?? 0;
                const total = entry?.total ?? 0;

                const dayHasOverdue = overdueCount > 0;
                const dayHasUpcoming = !dayHasOverdue && upcomingCount > 0;

                const borderAccent = dayHasOverdue
                  ? "border-red-500"
                  : dayHasUpcoming
                  ? "border-yellow-500"
                  : "border-white/20";

                const selectedAccent = isSelected ? "ring-4 ring-white" : "";
                const todayAccent = isToday && !isSelected ? "ring-2 ring-white/40" : "";

                cells.push(
                  <button
                    key={key}
                    onClick={() => setSelectedDay(cellDate)}
                    className={[
                      "rounded-lg border p-2 text-left min-h-[72px] relative transition",
                      inMonth ? "opacity-100" : "opacity-35",
                      borderAccent,
                      selectedAccent,
                      todayAccent,
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between">
                      <div className="text-sm font-semibold">{format(cellDate, "d")}</div>

                      {total > 0 && (
                        <div className="text-[10px] rounded-full border px-2 py-0.5 opacity-90">{total}</div>
                      )}
                    </div>

                    {(overdueCount > 0 || upcomingCount > 0) && (
                      <div className="absolute bottom-2 left-2 flex gap-2 text-[10px]">
                        {overdueCount > 0 && (
                          <span className="rounded-full border border-red-500 px-2 py-0.5">A: {overdueCount}</span>
                        )}
                        {upcomingCount > 0 && (
                          <span className="rounded-full border border-yellow-500 px-2 py-0.5">P: {upcomingCount}</span>
                        )}
                      </div>
                    )}
                  </button>
                );

                day = addDays(day, 1);
              }

              return cells;
            })()}
          </div>

          {/* Lista do dia selecionado */}
          <div className="rounded-lg border p-3">
            <div className="font-medium mb-2">{format(selectedDay, "dd/MM/yyyy")}</div>

            {selectedEvents.length === 0 ? (
              <div className="text-sm text-gray-600">Nada agendado para este dia.</div>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map((x) => (
                  <div key={x.treatmentId} className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{x.treatmentName}</div>
                      <div className="text-sm text-gray-600">
                        Última: {x.lastAppliedOn ?? "-"}
                        {x.daysToNext !== null ? ` • Faltam: ${x.daysToNext} dia(s)` : ""}
                      </div>
                    </div>

                    {role === "owner" && (
                      <button
                        className="rounded-md bg-black text-white px-3 py-1"
                        onClick={() => openMarkModal(x.treatmentId, x.treatmentName, selectedDay)}
                      >
                        Marcar…
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Sem histórico */}
      {noHistory.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Sem histórico</h2>
          <div className="rounded-xl border p-3 space-y-2">
            {noHistory.map((x) => (
              <div key={x.treatmentId} className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{x.treatmentName}</div>
                  <div className="text-sm text-gray-600">Nenhuma aplicação registrada ainda</div>
                </div>

                {role === "owner" && (
                  <button
                    className="rounded-md bg-black text-white px-3 py-1"
                    onClick={() => openMarkModal(x.treatmentId, x.treatmentName)}
                  >
                    Marcar…
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Atrasados */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Atrasados</h2>
        <div className="rounded-xl border p-3 space-y-2">
          {overdue.length === 0 ? (
            <p className="text-sm text-gray-600">Nenhum atraso 🎉</p>
          ) : (
            overdue.map((x) => (
              <div key={x.treatmentId} className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{x.treatmentName}</div>
                  <div className="text-sm text-gray-600">
                    Última: {x.lastAppliedOn ?? "-"} • Próxima: {x.nextDate ? fmtDateBR(x.nextDate) : "-"} • Atraso:{" "}
                    {Math.abs(x.daysToNext ?? 0)} dias
                  </div>
                </div>

                {role === "owner" && (
                  <button
                    className="rounded-md bg-black text-white px-3 py-1"
                    onClick={() => openMarkModal(x.treatmentId, x.treatmentName)}
                  >
                    Marcar…
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Próximos 60 dias */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Próximos 60 dias</h2>
        <div className="rounded-xl border p-3 space-y-2">
          {upcoming60.length === 0 ? (
            <p className="text-sm text-gray-600">Nada vencendo nos próximos 60 dias.</p>
          ) : (
            upcoming60.map((x) => (
              <div key={x.treatmentId} className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{x.treatmentName}</div>
                  <div className="text-sm text-gray-600">
                    Última: {x.lastAppliedOn ?? "-"} • Próxima: {x.nextDate ? fmtDateBR(x.nextDate) : "-"} • Faltam:{" "}
                    {x.daysToNext} dias
                  </div>
                </div>

                {role === "owner" && (
                  <button className="rounded-md border px-3 py-1" onClick={() => openMarkModal(x.treatmentId, x.treatmentName)}>
                    Marcar…
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* ✅ MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/60" onClick={closeModal} aria-label="Fechar" />

          <div className="relative w-full max-w-md rounded-2xl border bg-black p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Marcar aplicação</div>
                <div className="text-sm text-gray-400">{modalTreatmentName}</div>
              </div>
              <button className="rounded-md border px-3 py-1" onClick={closeModal} disabled={saving}>
                Fechar
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-300">Data da aplicação</label>
              <input
                type="date"
                value={modalDate}
                onChange={(e) => setModalDate(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2"
                disabled={saving}
              />
              <div className="text-xs text-gray-500">Dica: você pode registrar aplicações antigas também.</div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button className="rounded-md border px-3 py-1" onClick={closeModal} disabled={saving}>
                Cancelar
              </button>
              <button className="rounded-md bg-white text-black px-3 py-1" onClick={saveApplication} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}