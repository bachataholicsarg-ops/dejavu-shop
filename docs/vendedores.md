# Sistema de vendedores y comisiones

## Regla principal
Cada vendedor tiene un `codigo` único y un `porcentaje_comision`.

Ejemplos de enlaces:
- `/?vendedor=laura`
- `/?vendedor=estefania`

El código queda guardado durante la sesión de compra y se aplica al pedido.

## Cálculo
La comisión se calcula sobre el subtotal de productos, no sobre el envío:

`comision_total = subtotal * porcentaje_comision / 100`

## Ejemplo
Venta: $60.000
Comisión: 10%
Comisión del vendedor: $6.000

## Panel administrador
Debe permitir:
- alta y baja de vendedores
- porcentaje por vendedor
- total vendido
- comisión acumulada
- comisión pendiente
- marcar comisión como pagada

## Panel vendedor
Cada vendedor verá solamente:
- sus pedidos
- total vendido
- comisión generada
- comisión pagada
- comisión pendiente

## Privacidad
El cliente no ve porcentajes ni comisiones.
