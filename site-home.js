const publishedTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
});

for (const time of document.querySelectorAll('time[datetime]')) {
    const date = new Date(time.dateTime);
    if (Number.isFinite(date.getTime())) time.textContent = publishedTime.format(date);
}

async function loadSiteTitle() {
    let title = '博客';
    try {
        const response = await fetch('/.site-config.json', { cache: 'no-cache' });
        if (response.ok) {
            const config = await response.json();
            if (typeof config.siteTitle === 'string' && config.siteTitle.trim()) title = config.siteTitle.trim();
        }
    } catch {}
    document.title = title;
    document.getElementById('site-title').textContent = title;
}

loadSiteTitle();
