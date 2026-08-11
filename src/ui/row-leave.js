// Deixa a linha sair da tela antes de o dado sumir.
//
// Sem isto, excluir uma despesa é um `render()` e a linha simplesmente deixa
// de existir — o usuário não vê o que aconteceu, só o resultado.
//
// O ponto delicado NÃO é a animação, é a garantia: o `depois` (que apaga o
// dado e repinta) tem que rodar EXATAMENTE UMA VEZ. Zero vezes deixaria o app
// travado achando que excluiu; duas vezes apagaria em dobro. Dá pra errar dos
// dois lados:
//   · `animationend` não dispara com a aba em segundo plano, nem se a linha
//     for removida por outro render no meio do caminho → precisa de timeout;
//   · com timeout E evento, os dois podem disparar → precisa de trava.
// Por isso isto é um módulo com teste, e não quatro linhas soltas no handler.

export const createRowLeave = ({ setTimeout: agendar, clearTimeout: cancelar }) =>
  (elementos, { duracao, classe = 'row-leaving', folga = 60 } = {}, depois) => {
    const alvos = [].concat(elementos || []).filter(Boolean);

    // Nada pra animar, ou movimento desligado (duracao 0 vem do
    // prefers-reduced-motion): o dado some na hora, sem cerimônia.
    if (alvos.length === 0 || !(duracao > 0)) { depois(); return; }

    let feito = false;
    let timer = null;
    const fim = () => {
      if (feito) return;
      feito = true;
      if (timer !== null) cancelar(timer);
      depois();
    };

    for (const el of alvos) {
      el.classList.add(classe);
      // Saindo, a linha não pode mais receber toque — dá pra tocar em
      // "Excluir" duas vezes durante a animação.
      el.addEventListener('animationend', fim, { once: true });
    }
    // As linhas animam juntas e com a mesma duração, então o primeiro
    // animationend já vale por todas.
    timer = agendar(fim, duracao + folga);
  };
