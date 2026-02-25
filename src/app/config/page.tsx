"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type PetRow = { id: string; name: string };
type TreatmentRow = {
  id: string;
  pet_id: string;
  category: string;
  name: string;
  interval_value: number;
  interval_unit: "days" | "months";
  alerts_days: number[];
};

const CATEGORY_OPTIONS = [
  { value: "vaccine", label: "Vacina" },
  { value: "vermifuge", label: "Vermífugo" },
  { value: "flea_tick", label: "Carrapato/Pulga" },
  { value: "medicine", label: "Remédio" },
  { value: "other", label: "Outro" },
];

export default function ConfigPage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [role, setRole] = useState<"owner" | "viewer" | null>(null);
  const [petId, setPetId] = useState<string | null>(null);
  const [treatments, setTreatments] = useState<TreatmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // form
  const [category, setCategory] = useState("vaccine");
  const [name, setName] = useState("");
  const [intervalValue, setIntervalValue] = useState<number>(12);
  const [intervalUnit, setIntervalUnit] = useState<"days" | "months">("months");
  const [alertsText, setAlertsText] = useState("30,15,5");

  const alertsParsed = useMemo(() => {
    // transforma "30,15,5" => [30,15,5]
    const arr = alertsText
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n >= 0);

    // remove duplicados e ordena desc
    return Array.from(new Set(arr)).sort((a, b) => b - a);
  }, [alertsText]);

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

      // pet Zeus (pode trocar depois)
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
        setError('Pet "Zeus" não encontrado (ou sem acesso via RLS).');
        setLoading(false);
        return;
      }

      const pet = pets[0] as PetRow;
      setPetId(pet.id);

      // role do usuário nesse pet (precisa ser owner pra cadastrar)
      const userId = sessionData.session.user.id;
      const { data: member, error: memberErr } = await supabase
        .from("pet_members")
        .select("role")
        .eq("pet_id", pet.id)
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

      setRole(member[0].role);

      // listar tratamentos
      const { data: trs, error: trErr } = await supabase
        .from("treatments")
        .select("id,pet_id,category,name,interval_value,interval_unit,alerts_days")
        .eq("pet_id", pet.id)
        .order("category", { ascending: true })
        .order("name", { ascending: true });

      if (trErr) {
        setError(`Erro ao listar tratamentos: ${trErr.message}`);
        setLoading(false);
        return;
      }

      setTreatments((trs ?? []) as TreatmentRow[]);
      setLoading(false);
    })();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function createTreatment() {
    setError(null);

    if (role !== "owner") {
      setError("Somente o owner pode cadastrar/alterar tratamentos.");
      return;
    }
    if (!petId) {
      setError("Pet não carregado.");
      return;
    }
    if (!name.trim()) {
      setError("Informe o nome do tratamento.");
      return;
    }
    if (!intervalValue || intervalValue <= 0) {
      setError("Periodicidade inválida.");
      return;
    }
    if (alertsParsed.length === 0) {
      setError('Alertas inválidos. Use algo como "30,15,5".');
      return;
    }

    const payload = {
      pet_id: petId,
      category,
      name: name.trim(),
      interval_value: intervalValue,
      interval_unit: intervalUnit,
      alerts_days: alertsParsed,
    };

    const { error: insErr } = await supabase.from("treatments").insert([payload]);

    if (insErr) {
      setError(`Erro ao criar tratamento: ${insErr.message}`);
      return;
    }

    // recarregar lista
    const { data: trs, error: trErr } = await supabase
      .from("treatments")
      .select("id,pet_id,category,name,interval_value,interval_unit,alerts_days")
      .eq("pet_id", petId)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (trErr) {
      setError(`Criou, mas falhou ao recarregar lista: ${trErr.message}`);
      return;
    }

    setTreatments((trs ?? []) as TreatmentRow[]);
    setName("");
  }

  async function deleteTreatment(id: string) {
    setError(null);

    if (role !== "owner") {
      setError("Somente o owner pode deletar tratamentos.");
      return;
    }
    if (!confirm("Tem certeza que deseja deletar este tratamento?")) return;

    const { error: delErr } = await supabase.from("treatments").delete().eq("id", id);

    if (delErr) {
      setError(`Erro ao deletar: ${delErr.message}`);
      return;
    }

    setTreatments((prev) => prev.filter((t) => t.id !== id));
  }

  if (loading) return <div className="p-6">Carregando...</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Configurações — Zeus</h1>
          <p className="text-sm text-gray-600">
            Logado como: {email} {role ? `(${role})` : ""}
          </p>
        </div>

        <div className="flex gap-2">
          <a className="rounded-md border px-3 py-1" href="/agenda">
            Voltar
          </a>
          <button className="rounded-md border px-3 py-1" onClick={logout}>
            Sair
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {/* Form */}
      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Cadastrar tratamento</h2>

        {role !== "owner" && (
          <div className="text-sm text-yellow-400">
            Você está como <b>viewer</b>. Somente owner pode cadastrar.
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm text-gray-300">Categoria</label>
            <select
              className="w-full rounded-md border bg-transparent px-3 py-2"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={role !== "owner"}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-300">Nome</label>
            <input
              className="w-full rounded-md border bg-transparent px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: V10, NexGard, Vermífugo…"
              disabled={role !== "owner"}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-300">Periodicidade</label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                className="w-full rounded-md border bg-transparent px-3 py-2"
                value={intervalValue}
                onChange={(e) => setIntervalValue(Number(e.target.value))}
                disabled={role !== "owner"}
              />
              <select
                className="rounded-md border bg-transparent px-3 py-2"
                value={intervalUnit}
                onChange={(e) => setIntervalUnit(e.target.value as any)}
                disabled={role !== "owner"}
              >
                <option value="days">dias</option>
                <option value="months">meses</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-300">Alertas (dias antes)</label>
            <input
              className="w-full rounded-md border bg-transparent px-3 py-2"
              value={alertsText}
              onChange={(e) => setAlertsText(e.target.value)}
              placeholder="30,15,5"
              disabled={role !== "owner"}
            />
            <div className="text-xs text-gray-500">
              Interpretado como: [{alertsParsed.join(", ")}]
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            className="rounded-md bg-white text-black px-3 py-2"
            onClick={createTreatment}
            disabled={role !== "owner"}
          >
            Salvar tratamento
          </button>
        </div>
      </section>

      {/* Listagem */}
      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Tratamentos cadastrados</h2>

        {treatments.length === 0 ? (
          <div className="text-sm text-gray-600">Nenhum tratamento cadastrado.</div>
        ) : (
          <div className="space-y-2">
            {treatments.map((t) => (
              <div key={t.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-sm text-gray-600">
                    Categoria: {t.category} • A cada {t.interval_value} {t.interval_unit} • Alertas:{" "}
                    {(t.alerts_days ?? []).join(", ")}
                  </div>
                </div>

                {role === "owner" && (
                  <button className="rounded-md border px-3 py-1" onClick={() => deleteTreatment(t.id)}>
                    Deletar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}