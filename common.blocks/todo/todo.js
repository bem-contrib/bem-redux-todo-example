/**
 * @module todo
 */
modules.define('todo',
    ['i-bem__dom', 'redux-state-container', 'checkbox', 'button', 'BEMHTML'],
    function(provide, BEMDOM, ReduxStateContainer, Checkbox, Button, BEMHTML) {

/**
 * @exports
 * @class todo
 * @abstract
 * @bem
 */
provide(BEMDOM.decl({ block:this.name, baseBlock: ReduxStateContainer }, /** @lends todo.prototype */{
    onSetMod: {
        js: {
            inited() {
                this.__base.apply(this, arguments);

                this.bAddTodoInput = this.findBlockInside('header', 'input');
                this.bAddTodoInput.bindTo('control', 'keydown', e => {
                    // Enter key
                    if (e.which === 13) {
                        this.addTodo(e.target.value);
                    }
                });
                this.bAddTodoInput.bindTo('control', 'blur', e => this.addTodo(e.target.value));

                Checkbox.on(this.elem('list'), { modName: 'checked', modVal: '*'}, e => this.actTodoItem(e.target, 'COMPLETE_TODO'), this);

                Button.on(this.elem('list'), 'click', e => this.actTodoItem(e.target, 'DELETE_TODO'), this);

                this.bFilterGroup = this.findBlockInside('footer', 'radio-group');
                this.bFilterGroup.on('change', e => this.store.dispatch({ type: 'FILTER', filterType: e.target.getVal() }));

                this.bClearButton = this.findBlockInside('clear-completed', 'button');
                this.bClearButton.on('click', () => this.store.dispatch({ type: 'CLEAR_COMPLETED' }));

                // Update todo list when store is changed
                this.store.subscribe(() => this.onStoreChange());
            }
        }
    },

    /**
     * Dispatch add_todo
     * @param {String} text Todo text
     */
    addTodo(text) {
        text = text.trim();
        if (text.length) {
            this.store.dispatch({ type: 'ADD_TODO', text: text });
            this.bAddTodoInput.setVal('');
        }
    },

    /**
     * Dispatch action with todo item
     * @param {BEM} targetBlock Interacted BEM block
     * @param {String} actionType Type of action
     */
    actTodoItem(targetBlock, actionType) {
        const $item = targetBlock.domElem.closest('.todo__item');
        const itemId = this.elemParams($item).id;
        this.store.dispatch({ type: actionType, id: itemId });
    },

    /**
     * Handler of store changing
     */
    onStoreChange() {
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
    rootReducer(state, action) {
        // You can use Redux.combineReducers here (add module redux in dependencies of ym-module).
        // See http://redux.js.org/docs/api/combineReducers.html
        return {
            todos: this.todosReducer(state.todos, action)
        };
    },

    /**
     * Reducer for todo actions
     * @param {Object} state Previous state
     * @param {Object} action Action
     * @param {String} action.type Type of action
     * @returns {Object} New state
     */
    todosReducer(state, action) {
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
    }
}));

});
