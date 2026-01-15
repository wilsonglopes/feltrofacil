const { createClient } = require('@supabase/supabase-js');
const { MercadoPagoConfig, Preference } = require('mercadopago');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (!process.env.MP_ACCESS_TOKEN) throw new Error('ERRO: MP_ACCESS_TOKEN não configurado.');
    
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    if (!event.body) throw new Error('Nenhum dado recebido.');
    const { productId } = JSON.parse(event.body);

    // Busca o produto
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (error || !product) throw new Error('Produto não encontrado.');

    // Cria a preferência
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
        payer: { email: "cliente@email.com" },
        back_urls: {
          success: "https://loja.feltrofacil.com.br/sucesso.html",
          failure: "https://loja.feltrofacil.com.br/",
          pending: "https://loja.feltrofacil.com.br/"
        },
        auto_return: "approved",
        notification_url: "https://feltrofacil.netlify.app/.netlify/functions/webhook-delivery"
      }
    });

    return {
      statusCode: 200,
      headers,
      // MUDANÇA AQUI: Agora enviamos o PREÇO (amount) de volta para o site
      body: JSON.stringify({ 
          preferenceId: preferenceData.id, 
          amount: Number(product.price) 
      }),
    };

  } catch (error) {
    console.error('ERRO:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
