const mercadopago = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // 1. Configurar
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  mercadopago.configurations.setAccessToken(process.env.MP_ACCESS_TOKEN);
  
  try {
    const { productId } = JSON.parse(event.body);

    // 2. Buscar dados reais do produto no banco (segurança contra alteração de preço no front)
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (error || !product) throw new Error('Produto não encontrado');

    // 3. Criar preferência no Mercado Pago
    const preference = {
      items: [
        {
          title: `Apostila: ${product.title}`,
          unit_price: Number(product.price),
          quantity: 1,
          currency_id: 'BRL'
        }
      ],
      external_reference: product.id, // IMPORTANTE: ID do produto vai aqui
      back_urls: {
        success: "https://loja.feltrofacil.com.br/sucesso.html", // Crie esta página simples agradecendo
        failure: "https://loja.feltrofacil.com.br/",
      },
      auto_return: "approved",
      notification_url: "https://loja.feltrofacil.com.br/.netlify/functions/webhook-delivery" // Onde o MP avisa que pagou
    };

    const response = await mercadopago.preferences.create(preference);

    return {
      statusCode: 200,
      body: JSON.stringify({ init_point: response.body.init_point }),
    };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
