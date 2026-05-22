// ── Score global — moyenne pondérée ──
    let totalScore = 0;
    let nbMoisScore = 0;
    try {
      const fondsUrgenceObjectif = revenuReference > 0 ? revenuReference * 6 : 3720000;
      for (const anneeRec of annees) {
        for (let m = 1; m <= 12; m++) {
          const budgetsMois = budgets.filter(b =>
            b.anneeId === anneeRec.id && Number(b.mois) === m
          );
          if (budgetsMois.length === 0) continue;
          const totRev = budgetsMois.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
          if (totRev === 0) continue;
          const totDep    = budgetsMois.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
          const totDepAnt = budgetsMois.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantAnticipe), 0);
          const totEp     = budgetsMois.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
          const totFU     = budgetsMois.filter(b => b.categorie.type === 'epargne_precaution').reduce((s, b) => s + n(b.montantReel), 0);
          const soldeMois = totRev - totDep - totEp;
          let scoreMois   = 0;
          if (totDepAnt > 0) scoreMois += Math.min(5, (totDepAnt / Math.max(totDep, 1)) * 5);
          else scoreMois += 3;
          scoreMois += Math.min(5, ((totRev > 0 ? totEp / totRev : 0) / 0.30) * 5);
          scoreMois += soldeMois >= 0 ? 5 : Math.max(0, 5 + (soldeMois / totRev) * 5);
          scoreMois += Math.min(5, ((fondsUrgenceObjectif > 0 ? totFU / fondsUrgenceObjectif : 0) / 0.5) * 5);
          totalScore += Math.round(scoreMois);
          nbMoisScore++;
        }
      }
    } catch (scoreErr) {
      console.error('Score calculation error:', scoreErr);
    }
    const scoreGlobal = nbMoisScore > 0 ? Math.round(totalScore / nbMoisScore) : 0;