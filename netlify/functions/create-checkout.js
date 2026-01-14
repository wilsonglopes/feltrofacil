const { createClient } = require('@supabase/supabase-js');
const { MercadoPagoConfig, Preference } = require('mercadopago');

exports.handler = async function(event) {
  // Cabeçalhos para permitir que o seu site converse com essa função (CORS)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // 1. Configuração
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const { productId } = JSON.parse(event.body);

    // 2. Buscar produto no banco para garantir o preço correto
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (error || !product) throw new Error('Produto não encontrado.');

    // 3. Criar a preferência de pagamento
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
        external_reference: product.id, // ID do produto para sabermos o que entregar
        payer: {
            email: "test_user_123@testuser.com" // O MP pede um email dummy se não tiver login, o usuário preenche no checkout real
        },
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
    console.error('Erro no checkout:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
