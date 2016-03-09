var BemjsonToHtmlTech = require('enb-bemxjst/techs/bemjson-to-html'),
    BemhtmlTech = require('enb-bemxjst/techs/bemhtml'),
    FileProvideTech = require('enb/techs/file-provider'),
    bemTechs = require('enb-bem-techs'),
    CSSTech = require('enb-css/techs/css'),
    stylusTech = require('enb-stylus/techs/stylus'),
    BrowserJsTech = require('enb-js/techs/browser-js'),
    prependModules = require('enb-modules/techs/prepend-modules'),
    jsBabel = require('enb-babel/techs/js-babel');

module.exports = function(config) {
    var levels = [
        { path: 'libs/bem-core/common.blocks', check: false },
        { path: 'libs/bem-core/desktop.blocks', check: false },
        { path: 'libs/bem-components/common.blocks', check: false },
        { path: 'libs/bem-components/design/common.blocks', check: false },
        { path: 'libs/bem-components/desktop.blocks', check: false },
        { path: 'libs/bem-components/design/desktop.blocks', check: false },
        { path: 'libs/bem-redux/common.blocks', check: false },
        'common.blocks'
    ];

    config.node('desktop.bundles/index', function(node) {
        // Get BEMJSON file
        node.addTech([FileProvideTech, { target: '?.bemjson.js' }]);

        // Get FileList
        node.addTechs([
            [bemTechs.levels, { levels: levels }],
            [bemTechs.bemjsonToBemdecl],
            [bemTechs.deps],
            [bemTechs.files]
        ]);

        // Build BEMHTML file
        node.addTech([BemhtmlTech, { sourceSuffixes: ['bemhtml.js', 'bemhtml'] }]);
        node.addTarget('?.bemhtml.js');

        // Build HTML file
        node.addTech(BemjsonToHtmlTech);
        node.addTarget('?.html');

        // Build CSS file
        node.addTech(stylusTech);
        node.addTarget('?.css');

        // Build browser JS file
        node.addTech([jsBabel, { target: '?.pre.js' }]);
        node.addTarget('?.pre.js');

        // Add YM modules
        node.addTech([prependModules, {
          target: '?.js',
          source: '?.pre.js'
        }]);
        node.addTarget('?.js');
    });
};
