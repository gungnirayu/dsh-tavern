import test from 'node:test'
import assert from 'node:assert/strict'
import { generateImage, testImageChannel } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const channel = { id: 'relay', provider: 'novelai', baseUrl: 'https://relay.example.com', model: 'nai-diffusion-4-5-full', authMode: 'bearer', apiKey: 'sk-test',
  options: { protocol: 'chat', sampler: 'k_dpmpp_2m_sde', sizeWidth: '832', sizeHeight: '1216' } }

test('NovelAI 对话格式：按中转站的中文字段模板请求，从回复文字里的链接取图', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (init.method === 'POST') return new Response(JSON.stringify({ choices: [{ message: { content: '生成好了 ![图](https://img.example.com/a.png)' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  const image = await generateImage(channel, { positive: '1girl,\nsmile', negative: 'lowres' }, { fetchImpl })
  assert.equal(calls[0].url, 'https://relay.example.com/v1/chat/completions')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'nai-diffusion-4-5-full:k_dpmpp_2m_sde')
  assert.equal(body.messages[0].content, '提示词:1girl, smile\n画师串:\n尺寸:竖图\n提示词引导值:5\n缩放引导值:0\n负面提示词:lowres\n采样器:k_dpmpp_2m_sde')
  assert.deepEqual(body.nai, { tag: '1girl, smile', artist: '', size: '竖图', scale: 5, cfg: 0, negative: 'lowres', sampler: 'k_dpmpp_2m_sde', noise_schedule: 'karras' })
  assert.equal(calls[1].url, 'https://img.example.com/a.png')
  assert.deepEqual(Buffer.from(image.bytes), PNG)
})

test('NovelAI 对话格式：回复里没有图片链接时把原因报出来；测试连接探 /v1/models', async () => {
  const reply = async () => new Response(JSON.stringify({ choices: [{ message: { content: '余额不足' } }] }), { status: 200 })
  await assert.rejects(generateImage(channel, { positive: 'x' }, { fetchImpl: reply }), /没有返回图片链接：余额不足/)
  let probed
  await testImageChannel(channel, { fetchImpl: async url => { probed = url; return new Response(JSON.stringify({ data: [{ id: 'nai-diffusion-4-5-full:k_euler' }] }), { status: 200 }) } })
  assert.equal(probed, 'https://relay.example.com/v1/models')
})
