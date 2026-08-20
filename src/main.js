import './style.css';
import leaderboard from './pages/leaderboard.js';
import traderDetail from './pages/traderDetail.js';
import insights from './pages/insights.js';
import predictions from './pages/predictions.js';
import edge from './pages/edge.js';

const pageContent = document.getElementById('page-content');
const navLinks = document.querySelectorAll('.nav__link');

/**
 * Hash-based router
 */
async function handleRoute() {
  const hash = window.location.hash || '#edge';
  console.log('[Router] Navigating to:', hash);

  // Update active state in Navigation Links
  navLinks.forEach(link => {
    const dataPage = link.getAttribute('data-page');
    if (hash === `#${dataPage}` || (dataPage === 'leaderboard' && hash.startsWith('#trader/'))) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Render view
  try {
    if (hash === '#edge' || hash === '') {
      await edge.render(pageContent);
    } else if (hash === '#leaderboard') {
      await leaderboard.render(pageContent);
    } else if (hash.startsWith('#trader/')) {
      const parts = hash.split('/');
      const wallet = parts[1];
      await traderDetail.render(pageContent, wallet);
    } else if (hash === '#insights') {
      await insights.render(pageContent);
    } else if (hash === '#predictions') {
      await predictions.render(pageContent);
    } else {
      // Route fallback
      window.location.hash = '#edge';
    }
  } catch (error) {
    console.error('[Router] Error rendering view:', error);
    pageContent.innerHTML = `
      <div class="error-state">
        <svg class="error-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3 class="error-state__title">Navigation Error</h3>
        <p class="error-state__message">An error occurred while loading this page. Please try again.</p>
        <a href="#edge" class="btn btn--primary">Go to Sharp Edge</a>
      </div>
    `;
  }
}

// Global router event listeners
window.addEventListener('hashchange', handleRoute);

// Execute immediately since module script is loaded deferred
handleRoute();
