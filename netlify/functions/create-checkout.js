const { createClient } = require('@supabase/supabase-js');
const { MercadoPagoConfig, Preference } = require('mercadopago');

exports.handler = async function(event, context) {
  // Cabeçalhos para evitar erros de CORS no navegador
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // 1. Configuração Inicial
    // ATENÇÃO: Verifique se essas variáveis estão no Netlify
    if (!process.env.MP_ACCESS_TOKEN || !process.env.SUPABASE_URL) {
        throw new Error('Variáveis de ambiente não configuradas (MP_ACCESS_TOKEN ou SUPABASE).');
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const { productId } = JSON.parse(event.body);

    // 2. Buscar dados do produto no banco (Segurança: pegar preço real)
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (error || !product) throw new Error('Produto não encontrado no banco de dados.');

    // 3. Criar a Preferência no Mercado Pago
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
        // ID do produto vai aqui para sabermos o que entregar depois
        external_reference: product.id, 
        payer: {
            // O MP exige um email válido em produção, ou pede para o cliente preencher lá
            email: "cliente@email.com" 
        },
        back_urls: {
          success: "https://loja.feltrofacil.com.br/sucesso.html", // Vamos criar essa página jájá
          failure: "https://loja.feltrofacil.com.br/",
          pending: "https://loja.feltrofacil.com.br/"
        },
        auto_return: "approved",
        // AQUI ESTÁ A MÁGICA: O MP avisa este link quando pagarem
        notification_url: "https://loja.feltrofacil.com.br/.netlify/functions/webhook-delivery"
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ init_point: preferenceData.init_point }),
    };

  } catch (error) {
    console.error('Erro Fatal no Checkout:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Erro interno no servidor.' }),
    };
  }
};
