import './style.css';

// The old betting model was removed. Clear any slips this browser saved from it.
for (const key of ['dailyParlay.log.v1', 'dailyParlay.amount']) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

document.getElementById('slip').innerHTML =
  '<p>No bets right now. The model is being rebuilt from scratch.</p>';
