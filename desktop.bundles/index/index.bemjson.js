var page = [
    {
        block: 'page',
        title: 'Todo example for bem-redux',
        mods: { theme: 'normal' },
        styles: [
            { elem: 'css', url: 'index.css' }
        ],
        scripts: [
            { elem: 'js', url: 'index.js' },
            { elem: 'js', url: 'index.bemhtml.js' }
        ],
        content: [
            { block: 'todo' }
        ]
    }
];

module.exports = page;
