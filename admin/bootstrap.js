import('./editor.js').then(() => {
    document.getElementById('status').textContent = '';
    document.getElementById('token').disabled = false;
    document.getElementById('connect').disabled = false;
}).catch(error => {
    console.error('Editor startup failed', error);
    document.getElementById('status').textContent = '编辑器脚本加载失败，请刷新页面后重试。';
});
