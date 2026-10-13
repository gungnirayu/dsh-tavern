import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'

for(const fallback of [false,true])test(`record packs preserve hash lookup, standalone dedup and detached reads; fallback=${fallback}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'record-pack-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const options=fallback?{linkFile:async()=>{throw Object.assign(Error('unsupported'),{code:'ENOTSUP'})}}:{}
 const store=createConversationPageStore({root,...options})
 const values=[{type:'scalar',value:'one'},{type:'scalar',value:'two'}]
 const refs=await store.writeRecords('a',values)
 const file=ref=>join(root,'a/blocks',ref.slice(0,2),ref+'.json')
 assert.equal(JSON.parse(await readFile(file(refs[0]),'utf8')).kind,fallback?'record':'record-pack-v1')
 if(!fallback)assert.equal((await stat(file(refs[0]))).ino,(await stat(file(refs[1]))).ino)
 const fresh=createConversationPageStore({root})
 for(let i=0;i<refs.length;i++)assert.deepEqual(await fresh.readRecord('a',refs[i]),values[i])
 const modified=await fresh.readRecord('a',refs[0]);modified.value='changed'
 assert.deepEqual(await fresh.readRecord('a',refs[0]),values[0])
 assert.equal(await store.writeRecord('a',values[0]),refs[0])
 assert.deepEqual(await store.writeRecords('a',values),refs)
 await writeFile(file(refs[0]),'{corrupt')
 await assert.rejects(createConversationPageStore({root}).readRecord('a',refs[0]),/checksum/)
})
