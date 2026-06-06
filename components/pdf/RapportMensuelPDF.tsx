import {
  Document, Page, Text, View, StyleSheet,
} from "@react-pdf/renderer"

const COLORS_LIST = [
  "#6366f1","#f59e0b","#10b981","#ef4444",
  "#3b82f6","#8b5cf6","#f97316","#06b6d4",
]

const s = StyleSheet.create({
  page: { backgroundColor: "#fff", padding: 40, fontFamily: "Helvetica", fontSize: 10 },
  header: { marginBottom: 24, paddingBottom: 12, borderBottom: "2 solid #6366f1" },
  titleBig: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#111827" },
  titleSub: { fontSize: 11, color: "#6b7280", marginTop: 3 },
  titleDate: { fontSize: 9, color: "#9ca3af", marginTop: 2 },

  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  summaryCard: {
    flex: 1, backgroundColor: "#f8fafc", borderRadius: 6,
    padding: 10, border: "1 solid #e2e8f0",
  },
  summaryLabel: { fontSize: 8, color: "#94a3b8", marginBottom: 3 },
  summaryValue: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#1e293b" },
  summaryNote: { fontSize: 8, color: "#94a3b8", marginTop: 2 },

  sectionTitle: {
    fontSize: 12, fontFamily: "Helvetica-Bold", color: "#4f46e5",
    marginBottom: 8, borderBottom: "1 solid #e5e7eb", paddingBottom: 3,
    marginTop: 16,
  },
  row: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, borderBottom: "1 solid #f3f4f6" },
  rowAlt: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, backgroundColor: "#fafafa", borderBottom: "1 solid #f3f4f6" },
  rowHead: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, backgroundColor: "#f3f4f6", marginBottom: 1 },
  rowTotal: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, backgroundColor: "#ede9fe", marginTop: 3, borderRadius: 3 },
  colName: { flex: 2, color: "#374151" },
  colNum: { flex: 1, textAlign: "right", color: "#374151" },
  colHead: { fontFamily: "Helvetica-Bold", color: "#6b7280", fontSize: 9 },
  colTotal: { fontFamily: "Helvetica-Bold", color: "#4f46e5", fontSize: 10 },

  footer: {
    position: "absolute", bottom: 20, left: 40, right: 40,
    flexDirection: "row", justifyContent: "space-between",
    borderTop: "1 solid #e5e7eb", paddingTop: 6,
  },
  footerText: { fontSize: 8, color: "#9ca3af" },
})

interface Enveloppe { categorie: string; budget: number; depenses: number }
interface Projet { nom: string; budget: number; depenses: number; statut: string }

interface Props {
  mois: string
  userName: string
  enveloppes: Enveloppe[]
  projets: Projet[]
}

const fmt = (n: number) => `${n.toFixed(0)} €`
const pct = (d: number, b: number) => b > 0 ? Math.round((d / b) * 100) : 0
const resteColor = (d: number, b: number) => {
  const p = pct(d, b)
  return p >= 100 ? "#ef4444" : p >= 80 ? "#f59e0b" : "#10b981"
}

export function RapportMensuelPDF({ mois, userName, enveloppes, projets }: Props) {
  const moisLabel = new Date(mois + "-01").toLocaleDateString("fr-FR", {
    month: "long", year: "numeric",
  })
  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  })

  const totalBudgetE = enveloppes.reduce((a, e) => a + e.budget, 0)
  const totalDepE = enveloppes.reduce((a, e) => a + e.depenses, 0)
  const totalBudgetP = projets.reduce((a, p) => a + p.budget, 0)
  const totalDepP = projets.reduce((a, p) => a + p.depenses, 0)
  const totalB = totalBudgetE + totalBudgetP
  const totalD = totalDepE + totalDepP

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.titleBig}>Rapport Mensuel Budget</Text>
          <Text style={s.titleSub}>{moisLabel}  —  {userName}</Text>
          <Text style={s.titleDate}>Genere le {today}</Text>
        </View>

        {/* Résumé */}
        <View style={s.summaryRow}>
          {[
            { label: "BUDGET TOTAL", value: fmt(totalB), note: "Enveloppes + Projets" },
            { label: "DEPENSES", value: fmt(totalD), note: `${pct(totalD, totalB)}% utilise` },
            { label: "RESTE", value: fmt(totalB - totalD), note: "Solde estime" },
          ].map((c) => (
            <View key={c.label} style={s.summaryCard}>
              <Text style={s.summaryLabel}>{c.label}</Text>
              <Text style={s.summaryValue}>{c.value}</Text>
              <Text style={s.summaryNote}>{c.note}</Text>
            </View>
          ))}
        </View>

        {/* Enveloppes */}
        <Text style={s.sectionTitle}>Enveloppes budgetaires</Text>
        <View style={s.rowHead}>
          <Text style={[s.colName, s.colHead]}>Categorie</Text>
          <Text style={[s.colNum, s.colHead]}>Budget</Text>
          <Text style={[s.colNum, s.colHead]}>Depense</Text>
          <Text style={[s.colNum, s.colHead]}>Reste</Text>
          <Text style={[s.colNum, s.colHead]}>%</Text>
        </View>
        {enveloppes.map((e, i) => (
          <View key={i} style={i % 2 === 0 ? s.row : s.rowAlt}>
            <Text style={s.colName}>{e.categorie}</Text>
            <Text style={s.colNum}>{fmt(e.budget)}</Text>
            <Text style={s.colNum}>{fmt(e.depenses)}</Text>
            <Text style={[s.colNum, { color: resteColor(e.depenses, e.budget) }]}>
              {fmt(e.budget - e.depenses)}
            </Text>
            <Text style={s.colNum}>{pct(e.depenses, e.budget)}%</Text>
          </View>
        ))}
        <View style={s.rowTotal}>
          <Text style={[s.colName, s.colTotal]}>TOTAL</Text>
          <Text style={[s.colNum, s.colTotal]}>{fmt(totalBudgetE)}</Text>
          <Text style={[s.colNum, s.colTotal]}>{fmt(totalDepE)}</Text>
          <Text style={[s.colNum, s.colTotal]}>{fmt(totalBudgetE - totalDepE)}</Text>
          <Text style={[s.colNum, s.colTotal]}>{pct(totalDepE, totalBudgetE)}%</Text>
        </View>

        {/* Projets */}
        <Text style={s.sectionTitle}>Projets</Text>
        <View style={s.rowHead}>
          <Text style={[s.colName, s.colHead]}>Projet</Text>
          <Text style={[s.colNum, s.colHead]}>Budget</Text>
          <Text style={[s.colNum, s.colHead]}>Alloue</Text>
          <Text style={[s.colNum, s.colHead]}>Statut</Text>
        </View>
        {projets.length === 0 ? (
          <View style={s.row}>
            <Text style={[s.colName, { color: "#9ca3af" }]}>Aucun projet</Text>
          </View>
        ) : (
          projets.map((p, i) => (
            <View key={i} style={i % 2 === 0 ? s.row : s.rowAlt}>
              <Text style={s.colName}>{p.nom}</Text>
              <Text style={s.colNum}>{fmt(p.budget)}</Text>
              <Text style={s.colNum}>{fmt(p.depenses)}</Text>
              <Text style={s.colNum}>{p.statut}</Text>
            </View>
          ))
        )}

        {/* Footer fixe */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>LAW-GestBudget — Document confidentiel</Text>
          <Text style={s.footerText}>{moisLabel}</Text>
        </View>
      </Page>
    </Document>
  )
}