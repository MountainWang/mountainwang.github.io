for (const section of document.querySelectorAll('[data-article-fragment]')) {
    fetch(section.dataset.articleFragment)
        .then(response => response.ok ? response.text() : null)
        .then(html => { if (html !== null) section.innerHTML = html.trim(); })
        .catch(() => {});
}
