block('todo')(
    js()(true),

    content()([
        { elem: 'header' },
        { elem: 'list' },
        { elem: 'footer' }
    ]),

    elem('header')(
        tag()('header'),
        content()([
            {
                elem: 'title',
                content: 'Todos'
            },
            {
                block: 'input',
                mods: { theme: 'islands', size: 'm', 'has-clear': true, focused: true },
                placeholder: 'What needs to be done?'
            }
        ])
    ),

    elem('title').tag()('h1'),

    elem('list').tag()('ul'),

    elem('item')(
        tag()('li'),
        content()(function() {
            var ctx = this.ctx || {};
            return [
                {
                    block: 'checkbox',
                    mods: { theme: 'islands', size: 'm', checked: ctx.checked },
                    text: ctx.text
                },
                {
                    block: 'button',
                    mods: { theme: 'islands', size: 'm' },
                    mix: { block: 'todo', elem: 'delete' },
                    text: 'Delete'
                }
            ];
        })
    ),

    elem('footer')(
        tag()('footer'),
        content()([
            {
                block: 'radio-group',
                mods: { theme: 'islands', size: 'm', type: 'button' },
                name: 'filter',
                val: 'show_all',
                options: [
                    { val: 'show_all', text: 'Show all' },
                    { val: 'show_active', text: 'Show active' },
                    { val: 'show_completed', text: 'Show completed' }
                ]
            },
            {
                block: 'button',
                mods: { theme: 'islands', size: 'm' },
                mix: { block: 'todo', elem: 'clear-completed' },
                text: 'Clear completed'
            }
        ])
    )
);
