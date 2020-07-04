const tape = require('tape')
const { Client } = require('..')

const { initDht, cleanupDht, BOOTSTRAP_ADDRESS } = require('./util/dht')
const { ServerClient } = require('./util/server')

async function prepare(opts = {}) {
    if (opts.network !== false) {
        await initDht()
        opts.network = true
        opts.bootstrap = BOOTSTRAP_ADDRESS
    }
    const context = new ServerClient(opts)
    await context.createServer()
    const endpoint = `http://localhost:${context.port}/api`
    const client = new Client({ endpoint })
    return [cleanup, client]
    async function cleanup() {
        await context.stop()
        await cleanupDht()
    }
}

tape('replicate resources with many peers', async t => {
    let cleanups = []
    let clients = []
    const numPeers = 60

    for (let i = 0; i < numPeers; i++) {
        const [cleanup, client] = await prepare({ network: true })
        cleanups.push(cleanup)
        clients.push(client)
    }

    let collections = []
    collections[0] = await clients[0].createCollection('maincollection')
    for (let i = 1; i < numPeers; i++) {
        collections[i] = await clients[i].createCollection('randomcollectionname', { key: collections[0].key, alias: 'randomalias'})
        console.log(`collection ${i} created`)
    }

    for (let i = 0; i < numPeers; i++) {
        await writeResource(collections[i], `file${i}`, `content${i}`)
        console.log(`resource ${i} created`)
    }

    await timeout(200)

    let contents2 = await readResources(collections[2])
    t.deepEqual(contents2.sort(), ['content0', 'content2'], 'collection 2 ok')

    await collections[9].addFeed(collections[6].info.localKey, { alias: 'collectionsix' })

    await timeout(200)

    contents9 = await readResources(collections[9])
    t.deepEqual(contents9.sort(), ['content0', 'content6', 'content9'], 'collection 9 ok')
    contents6 = await readResources(collections[6])
    t.deepEqual(contents6.sort(), ['content0', 'content6'], 'collection 6 ok')

    await Promise.all(cleanups.map(cleanup => cleanup()))
})

async function readResources(collection) {
    const records = await collection.query(
        'records',
        { schema: 'sonar/resource' },
        { waitForSync: true }
    )
    const contents = await Promise.all(records.map(r => {
        return collection.resources.readFile(r).then(c => c.toString())
    }))
    return contents
}

async function writeResource(collection, filename, content) {
    const resource = await collection.resources.create({ filename })
    await collection.resources.writeFile(resource, content)
    return resource
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
