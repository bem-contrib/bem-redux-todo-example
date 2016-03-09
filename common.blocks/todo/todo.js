/**
 * @module todo
 */
modules.define('todo',
    ['i-bem__dom', 'redux-state-container', 'checkbox', 'button', 'BEMHTML'],
    function(provide, BEMDOM, ReduxStateContainer, Checkbox, Button, BEMHTML) {

/**
 * Reducer for todo actions
 * @param {Object} state Previous state
 * @param {Object} action Action
 * @param {String} action.type Type of action
 * @returns {Object} New state
 */
const todosReducer = (state, action) => {
    switch (action.type) {
        case 'ADD_TODO':
            return [
                {
                    id: state.reduce((maxId, todo) => Math.max(todo.id, maxId), -1) + 1,
                    completed: false,
                    text: action.text
                },
                ...state
            ];

        case 'DELETE_TODO':
            return state.filter(todo =>
                todo.id !== action.id
            );

        case 'COMPLETE_TODO':
            return state.map(todo =>
                todo.id === action.id ?
                    Object.assign({}, todo, { completed: !todo.completed }) :
                    todo
            );

        case 'FILTER':
            const TODO_FILTERS = {
                'show_all': () => true,
                'show_active': todo => !todo.completed,
                'show_completed': todo => todo.completed
            };
            return state.map(todo =>
                Object.assign({}, todo, { hidden: !TODO_FILTERS[action.filterType](todo) })
            );

        case 'CLEAR_COMPLETED':
            return state.filter(todo => todo.completed === false);

        default:
            return state;
    }
};

/**
 * @exports
 * @class todo
 * @abstract
 * @bem
 */
provide(BEMDOM.decl({ block:this.name, baseBlock: ReduxStateContainer }, /** @lends todo.prototype */{
    onSetMod: {
        js: {
            inited: function() {
                this.__base.apply(this, arguments);

                this.bAddTodoInput = this.findBlockInside('header', 'input');
                this.bAddTodoInput.bindTo('control', 'keydown', e => {
                    const text = e.target.value.trim();
                    if (text.length && e.which === 13) {
                        this.store.dispatch({ type: 'ADD_TODO', text: text });
                        this.bAddTodoInput.setVal('');
                    }
                });
                this.bAddTodoInput.bindTo('control', 'blur', e => {
                    const text = e.target.value.trim();
                    if (text.length) {
                        this.store.dispatch({ type: 'ADD_TODO', text: text });
                        this.bAddTodoInput.setVal('');
                    }
                });

                Checkbox.on(this.elem('list'), { modName: 'checked', modVal: '*'}, e => {
                    const targetBlock = e.target;
                    const $item = targetBlock.domElem.closest('.todo__item');
                    const itemId = this.elemParams($item).id;
                    this.store.dispatch({ type: 'COMPLETE_TODO', id: itemId });
                }, this);

                Button.on(this.elem('list'), 'click', e => {
                    const targetBlock = e.target;
                    const $item = targetBlock.domElem.closest('.todo__item');
                    const itemId = this.elemParams($item).id;
                    this.store.dispatch({ type: 'DELETE_TODO', id: itemId });
                }, this);

                this.bFilterGroup = this.findBlockInside('footer', 'radio-group');
                this.bFilterGroup.on('change', e => {
                    this.store.dispatch({ type: 'FILTER', filterType: e.target.getVal() });
                });

                this.bClearButton = this.findBlockInside('clear-completed', 'button');
                this.bClearButton.on('click', () => {
                    this.store.dispatch({ type: 'CLEAR_COMPLETED' });
                });

                // Update todo list when store is changed
                this.store.subscribe(() => {
                    const listContentBemjson = this.store.getState().todos.map(todo => ({
                        block: 'todo',
                        elem: 'item',
                        elemMods: { hidden: todo.hidden },
                        js: { id: todo.id },
                        checked: todo.completed,
                        text: todo.text
                    }));
                    const listContent = BEMHTML.apply(listContentBemjson);
                    BEMDOM.update(this.elem('list'), listContent);
                });
            }
        }
    },

    /**
     * Returns initial state
     * @override
     * @returns {Object}
     */
    getInitialState: () => ({
        todos: []
    }),

    /**
     * Root reducer
     * @override
     * @param {Object} state Previous state
     * @param {Object} action Action
     * @param {String} action.type Type of action
     * @returns {Object} New state
     */
    rootReducer: (state, action) => ({
        todos: todosReducer(state.todos, action)
    })
}));

});
