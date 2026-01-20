const { MercadoPagoConfig, Preference } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  try {
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // Agora esperamos uma LISTA de IDs (cartItems)
    const { cartItems } = JSON.parse(event.body);

    if (!cartItems || cartItems.length === 0) throw new Error('Carrinho vazio.');

    // Busca os produtos no banco para garantir o preço real (segurança)
    const { data: products } = await supabase
      .from('products')
      .select('*')
      .in('id', cartItems);

    if (!products || products.length === 0) throw new Error('Produtos não encontrados.');

    // Calcula o total
    let totalAmount = 0;
    products.forEach(p => totalAmount += p.price);

    // Cria a preferência no Mercado Pago
    const body = {
      items: [{
        id: "carrinho-varios",
        title: `Compra Feltro Fácil (${products.length} itens)`,
        quantity: 1,
        unit_price: totalAmount
      }],
      back_urls: {
        success: "https://loja.feltrofacil.com.br/sucesso.html",
        failure: "https://loja.feltrofacil.com.br/",
        pending: "https://loja.feltrofacil.com.br/"
      },
      auto_return: "approved",
    };

    const result = await preference.create({ body });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        preferenceId: result.id, 
        amount: totalAmount // Devolve o total para o frontend mostrar
      }),
    };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
