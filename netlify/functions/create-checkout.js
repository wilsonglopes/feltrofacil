const { createClient } = require('@supabase/supabase-js');
const { MercadoPagoConfig, Preference } = require('mercadopago');

exports.handler = async function(event, context) {
  // Cabeçalhos de segurança (CORS)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // 1. Diagnóstico de Variáveis (Vai aparecer no Log do Netlify se falhar)
    if (!process.env.MP_ACCESS_TOKEN) throw new Error('ERRO: MP_ACCESS_TOKEN não está configurado.');
    if (!process.env.SUPABASE_URL) throw new Error('ERRO: SUPABASE_URL não está configurado.');

    // 2. Tenta conectar
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    // 3. Lê o produto enviado
    if (!event.body) throw new Error('Nenhum dado recebido no corpo da requisição.');
    const { productId } = JSON.parse(event.body);

    // 4. Busca no Banco
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (error || !product) throw new Error('Produto não encontrado: ' + (error ? error.message : 'ID inválido'));

    // 5. Cria o Pagamento
    const preferenceData = await preference.create({
      body: {
        items: [
          {
            title: `Apostila: ${product.title}`,
            unit_price: Number(product.price),
            quantity: 1,
            currency_id: 'BRL'
          }
        ],
        external_reference: product.id,
        payer: { email: "cliente@email.com" }, // Email genérico para iniciar checkout
        back_urls: {
          success: "https://loja.feltrofacil.com.br/sucesso.html",
          failure: "https://loja.feltrofacil.com.br/",
          pending: "https://loja.feltrofacil.com.br/"
        },
        auto_return: "approved",
        notification_url: "https://loja.feltrofacil.com.br/.netlify/functions/webhook-delivery"
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ init_point: preferenceData.init_point }),
    };

  } catch (error) {
    console.error('ERRO FATAL:', error); // Isso aparece no log do Netlify
    return {
      statusCode: 500, // Mantemos 500 para erro de servidor, mas mandamos o detalhe
      headers,
      // AQUI ESTÁ O TRUQUE: Mandamos a mensagem do erro para você ler no navegador
      body: JSON.stringify({ 
        error: error.message || 'Erro desconhecido', 
        details: error.toString() 
      }),
    };
  }
};
