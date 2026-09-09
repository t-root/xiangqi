const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('../engine/node_modules/@babel/parser');
const html = fs.readFileSync(path.join(__dirname, '../xiangqi-analyzer.html'), 'utf8');
const context = vm.createContext({ pikafishResourceSettings: new WeakMap() });
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const node of parser.parse(match[1]).program.body) {
        if (node.type === 'FunctionDeclaration' && node.id.name === 'configurePikafishResources')
            vm.runInContext(match[1].slice(node.start, node.end), context);
    }
}
const configure = context.configurePikafishResources;
for (const label of ['Native', 'Web']) {
    const target = {}, commands = [], send = command => commands.push(command);
    configure(target, send, 2);
    assert.deepEqual(commands.splice(0), ['setoption name Threads value 2', 'setoption name Hash value 128']);
    configure(target, send, 2);
    assert.equal(commands.length, 0, 'Repeated cache preparation must retain search memory');
    configure(target, send, 4);
    assert.deepEqual(commands.splice(0), ['setoption name Threads value 4']);
    configure(target, send, 4, 256);
    assert.deepEqual(commands.splice(0), ['setoption name Hash value 256']);
    context.pikafishResourceSettings.delete(target);
    configure(target, send, 4);
    assert.equal(commands.splice(0).length, 2, 'Restart must reapply both options');
    configure({}, send, 4);
    assert.equal(commands.splice(0).length, 2, 'New connection/module must initialize');
    const failed = {};
    assert.throws(() => configure(failed, () => { throw Error('transport failed'); }, 2));
    configure(failed, send, 2);
    assert.equal(commands.length, 2, 'Failed dispatch must not mark settings as applied');
    console.log('PASS ' + label + ': retain resources, changes, restart, reconnect, failed dispatch');
}
