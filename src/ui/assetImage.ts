import { ASSET_MANIFEST, PHOTO_CROP, READY_EXTERNAL_ASSETS, type AssetId } from '../data/assetManifest';

export { PHOTO_HOTSPOT } from '../data/assetManifest';
export type { AssetId } from '../data/assetManifest';

// 遵循 AGENTS 的 data 纯数据边界：程序化插画、缓存和 DOM 行为只属于 UI。
// 所有形状/文案均来自本模块或静态清单；不接收用户 HTML/SVG，不加载外部字体或图片。
const cache = new Map<AssetId, string>();
const ink = '#4b5757';
const paper = '#f6f0e3';
const yellow = '#ead99c';

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function lines(path: string, color = ink, width = 2): string {
  return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function tree(x: number, y: number, scale: number, color = '#809b83'): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M-10 30 0-178 13 30Z" fill="#737d70"/>
    ${lines('M0-70-51-153M3-107 52-187', '#737d70', 9)}
    <path d="M-86-138C-150-204-77-263-27-245 12-312 100-260 93-219 165-192 112-112 62-126 6-82-41-116-86-138Z" fill="${color}"/>
    <path d="M-95-196Q-82-251-28-235 20-282 66-236-14-246-32-192Z" fill="#e0dfb7" opacity=".25"/>
  </g>`;
}

function plant(x: number, y: number, scale = 1): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M-25 0-18 42H18L26 0Z" fill="#b6856d"/><path d="M-28 0H28" stroke="#e0b596" stroke-width="8"/>
    ${lines('M0 0V-75M0-30-32-56M0-43 26-78', '#738273', 4)}
    <path d="M0-49Q-50-98-43-45-17-27 0-49M2-28Q49-77 48-31 24-12 2-28M2-65Q-17-112 15-111 33-89 2-65" fill="#7e997d"/>
  </g>`;
}

// 足点位于 y=150；相同背影构图用于照片与淡彩画，不提供任何真实人脸。
function backPerson(x: number, y: number, scale: number, coat: string, girl = false): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})" data-motif="walking-back">
    <ellipse cx="3" cy="153" rx="37" ry="7" fill="#5d6762" opacity=".13"/>
    <path d="M-16 81-19 145-5 147 5 99 17 143 31 143 19 79Z" fill="#535d68"/>
    <path d="M-22 143-25 153H-3L-4 145M16 141 17 151H39L30 141" fill="#424c53"/>
    <path d="M-20 27Q1 18 22 28L32 90Q2 101-31 90Z" fill="${coat}"/>
    <path d="M-20 32-37 75-30 81-9 49M21 32 37 77 29 83 12 48" fill="${coat}" stroke="#4b5757" stroke-opacity=".18" stroke-width="3"/>
    <path d="M-37 75-31 87-25 83-29 76M31 79 33 91 40 87 37 77" fill="#cfa78a"/>
    <path d="M-11 7V27Q0 35 11 25V7" fill="#cfa78a"/>
    <path d="M-18 10Q-24-22 0-23 24-23 19 12L${girl ? '24 32Q0 42-25 27' : '9 21-13 19'}Z" fill="#42474b"/>
    ${lines('M-12 39-18 84M12 43 19 83', '#5e635b', 1.5)}
  </g>`;
}

// 内置兜底与外部全景共用右侧台阶热区。
function carryPair(): string {
  return `<g transform="translate(1232 458) scale(.42)" data-motif="father-carrying-linxia">
    <ellipse cx="4" cy="151" rx="54" ry="10" fill="#73776a" opacity=".2"/>
    <path d="M-16 83-22 143-8 148 3 107 17 142 33 147 21 85Z" fill="#515963"/>
    <path d="M-24 142-29 151H-5V144M18 141 19 151H41L31 142" fill="#3e484d"/>
    <path d="M-22 26Q1 12 24 28L33 95-29 97Z" fill="#758476"/>
    <circle cx="-3" cy="11" r="16" fill="#bd9980"/>
    <path d="M-20 10Q-24-14-5-15 19-17 17 12L5 4Z" fill="#56564e"/>
    <path d="M-11 30-35 51-30 74-13 68M21 29 44 48 33 78 21 69" fill="#758476"/>
    <path d="M-17 25-34 49-44 81-31 86-11 60 3 38M22 33 40 46 50 83 37 87 21 60 4 39" fill="#707685"/>
    <path d="M-45 80-50 91-30 94-28 86M39 84 39 94 59 94 49 81" fill="#f0e8d7"/>
    <path d="M-9-7Q10-20 28-1L34 41Q8 52-17 30Z" fill="${yellow}"/>
    <path d="M-7-3-24 17-13 26 8 9M23 0 30 19 8 23 5 12" fill="#efdfac"/>
    <path d="M0-18Q-2-35 14-32 33-31 29-12L32 6Q15 12 1 0Z" fill="#42484b"/>
    ${lines('M6 8 3 32M13 35 28 33', '#c2af7f', 2)}
  </g>`;
}

function gateScene(): string {
  let windows = '';
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      const x = 342 + col * 72;
      const y = 177 + row * 57;
      windows += `<path d="M${x} ${y}h32v32h-32Z" fill="#9fafab"/><path d="M${x + 4} ${y + 4}h24v10h-24Z" fill="#c9d2c4"/>`;
    }
  }
  let steps = '';
  for (let i = 0; i < 8; i += 1) {
    const y = 435 + i * 22;
    steps += `<path d="M${407 - i * 19} ${y}H${1117 + i * 24}l24 22H${388 - i * 19}Z" fill="${i % 2 ? '#c8cab9' : '#e3dfcc'}"/>${lines(`M${407 - i * 19} ${y}H${1117 + i * 24}`, '#a9b4a4', 2)}`;
  }
  return `<g data-composition="gate-panorama">
    <path d="M0 0H1600V900H0Z" fill="#e6ecdf"/>
    <path d="M0 97Q316 149 538 79T1098 80 1600 36V0H0Z" fill="#f9f4db"/>
    <circle cx="1250" cy="155" r="63" fill="#fff6d7"/>
    <path d="M180 340V167H305V110H1314V200H1475V394H180Z" fill="#d6d9c7"/>
    <path d="M302 126H1318V147H302Z" fill="#aab8a7"/>${windows}
    <path d="M0 377Q381 351 708 382T1600 352V900H0Z" fill="#dce0ca"/>
    ${tree(127, 440, 1.7, '#849d88')}${tree(1436, 434, 1.85, '#718e7a')}
    <path d="M401 268H1179V295H401Z" fill="#7c9185"/>
    <path d="M402 287H445V441H402ZM1140 287H1184V441H1140Z" fill="#bac7b0"/>
    <path d="M490 302Q786 324 1108 302V348Q794 367 490 347Z" fill="#b58270"/>
    <text x="800" y="339" text-anchor="middle" fill="#fff3d9" font-family="serif" font-size="25" letter-spacing="16">迎新报到</text>
    <path d="M454 364H1140V435H454Z" fill="#cad0bb"/>
    ${steps}
    ${lines('M390 568V423L500 384M389 457 500 414M1110 384 1260 571M1150 431V493M1210 499V549', '#879d91', 7)}
    <path d="M0 715 440 605H1298L1600 793V900H0Z" fill="#dfd5bb"/>
    ${lines('M0 819 632 627M602 900 860 626M1369 900 1083 626', '#c4c4b0', 2)}
    <path d="M0 814 270 720 711 900H233Z" fill="#adbd9f" opacity=".38"/>
    ${carryPair()}
    <g fill="#ad9875" stroke="#7e826a" stroke-width="2"><path d="M642 499h19l3 28h-24Z"/><path d="M667 505h21l3 25h-26Z"/>${lines('M646 499V491Q652 483 658 491V499M670 505V497Q678 489 685 497V505', '#7e826a', 2)}</g>
    ${backPerson(906, 480, .6, '#d6c6aa')}${backPerson(979, 482, .61, '#a6b4af', true)}
    ${backPerson(1050, 492, .58, '#b89887')}${backPerson(835, 495, .55, '#879c9b')}
    ${backPerson(250, 581, .98, '#7a9297')}${backPerson(336, 600, .93, '#c3ad93', true)}
    <g transform="translate(284 699)"><rect width="45" height="67" rx="7" fill="#b6856e"/>${lines('M12 0V-22H33V0M12 13V52M31 13V52', '#7e8276', 3)}<circle cx="8" cy="70" r="5" fill="${ink}"/><circle cx="38" cy="70" r="5" fill="${ink}"/></g>
    ${backPerson(1270, 574, .92, '#6a7885')}
    <path d="M1286 621 1300 605 1306 612 1293 638" fill="#6a7885"/><rect x="1300" y="592" width="12" height="22" rx="3" fill="#cf8252"/>
    ${plant(1510, 778, 2.1)}
    <path d="M0 867Q223 800 430 900H0Z" fill="#7d987d"/>
  </g>`;
}

function portrait(id: AssetId): string {
  const girl = id === 'portrait_linxia_casual' || id === 'portrait_linxia_smile';
  const smile = id === 'portrait_linxia_smile';
  const father = id === 'portrait_father';
  const teacher = id === 'portrait_teacher';
  const volunteer = id === 'portrait_volunteer';
  const ayuan = id === 'portrait_ayuan';
  const back = id === 'portrait_protagonist';
  const coat = girl ? yellow : father ? '#818979' : teacher ? '#909b89' : volunteer ? '#ece5d4' : ayuan ? '#536b7d' : '#91a9b0';
  const faceAngle = girl && !smile ? 8 : ayuan ? 5 : -3;
  const hair = girl ? '<path d="M222 222Q207 137 290 132 380 126 385 233L391 331 356 353 340 256 235 306 220 336Z" fill="#464b4d"/>'
    : teacher || volunteer ? '<ellipse cx="385" cy="198" rx="32" ry="38" fill="#51514b"/>' : '';
  let detail = '';
  if (girl) {
    detail = smile
      ? `<path d="M182 459 222 510 208 540 161 505M421 458 382 522 397 546 455 498" fill="#e7d29a"/>
         <g transform="rotate(-6 308 511)"><path d="M208 455H408V598H208Z" fill="#d0c4ad" opacity=".25"/><path d="M199 446H400V589H199Z" fill="#fff9ec"/>${lines('M215 550H381M222 560H385M227 570H389', '#bdc4ae')}${backPerson(274, 471, .48, '#8caaa7')}${backPerson(328, 481, .42, yellow, true)}</g>
         <path d="M210 518q-16-12-20 4l9 26 18-4M392 526q20-12 23 5l-13 24-17-6" fill="#d7b292"/>`
      : `<path d="M208 444 228 582 351 580 374 453" fill="#aa9a80"/><path d="M225 458H353V565H225Z" fill="#d9cfb7"/>
         <path d="M172 481Q203 518 291 521L293 548Q204 559 169 522M425 480Q390 540 282 559L276 534Q359 509 394 469" fill="#e4ce92"/>
         <path d="M280 521q39-3 40 11l-30 16M282 534q-33 1-34 13l32 12" fill="#d4ad8c"/>
         ${lines('M239 478H336M241 487H297', '#9c9987', 2)}`;
  } else if (father) {
    detail = `<path d="M163 506 148 578 171 586 185 516M433 505 446 578 422 589 409 519" fill="#c4a184"/>
      <path d="M99 617 198 604 218 751 88 758ZM404 623 493 631 503 759 385 754Z" fill="#b7a785"/>
      ${lines('M132 614V589Q146 565 175 588V608M417 625V601Q438 575 469 606V630', '#6b7463', 9)}
      ${lines('M115 650 107 739M175 640 192 735M410 652 399 736M474 653 486 745', '#958f76', 2)}
      <path d="M211 367h46v54h-46Z" fill="#738071"/>${lines('M212 379H256M312 338V609', '#c4c8b1', 3)}`;
  } else if (teacher) {
    detail = `<path d="M195 459 340 430 377 609 223 634Z" fill="#b9a88d"/><path d="M204 458 340 438 345 460 210 481Z" fill="#f0e6d2"/>
      <path d="M411 472Q371 548 263 551L258 576Q385 594 439 505" fill="#929d88"/><path d="M260 551 233 541 223 555 258 576" fill="#d3af90"/>
      ${lines('M233 232Q253 218 275 230M316 230Q339 218 359 230M278 231H314', '#737a70', 3)}
      <path d="M270 326 298 398 329 326" fill="#eee9d9"/>`;
  } else if (volunteer) {
    detail = `<path d="M390 373 459 419 494 359 510 371 482 459Q467 480 422 451" fill="#e9dfc9"/>
      <path d="M492 363 490 328 500 302 508 307 505 334 521 342 511 371" fill="#d4ae8e"/>
      <path d="M161 419 214 430 205 468 152 455" fill="#b47d69"/>
      <path d="M278 326 298 418 327 327" fill="none" stroke="#7f9891" stroke-width="5"/><rect x="278" y="405" width="49" height="66" rx="4" fill="#f7f2e4"/>
      ${lines('M289 438H315M289 447H311', '#9fa99a', 3)}<path d="M187 510 296 499 307 634 198 646Z" fill="#9aa693"/><path d="M227 510 262 506 264 515 228 519Z" fill="#d8c8a7"/>`;
  } else if (ayuan) {
    detail = `<path d="M165 453Q196 481 271 440L287 471Q220 539 169 505M425 450 345 485 330 460 393 415" fill="#506678"/>
      <g transform="rotate(-12 307 441)"><rect x="271" y="389" width="66" height="111" rx="10" fill="#cc8153"/><rect x="282" y="402" width="15" height="24" rx="5" fill="#665e57"/><circle cx="289" cy="409" r="4" fill="#c1b49a"/></g>
      <path d="M266 445q29-23 31-10l-13 36-12 5M332 456q-12-36-22-28l-3 35 22 14" fill="#caa68a"/>${lines('M229 324 246 395M366 323 352 392', '#92a4a6', 3)}`;
  } else if (!back) {
    detail = `<path d="M214 318 387 648" fill="none" stroke="#c8bc9e" stroke-width="19"/><path d="M369 558 451 574 437 705 360 686Z" fill="#b5ac93"/>
      <path d="M427 410 472 476 420 495 404 470 388 447" fill="#88a1a9"/><path d="M418 471 457 459 465 477 430 497" fill="#d3ad8d"/>
      <g transform="rotate(18 478 451)"><rect x="452" y="399" width="53" height="89" rx="7" fill="#53676c"/><rect x="458" y="406" width="41" height="64" rx="3" fill="#cedbd6"/></g>
      ${lines('M255 331 285 389 325 337M250 342 240 413M337 344 345 416', '#dae1d2', 4)}`;
  }
  if (back) {
    return `<ellipse cx="302" cy="754" rx="141" ry="17" fill="#596865" opacity=".12"/>
      ${backPerson(300, 189, 3.6, '#91a3a7')}
      <path d="M250 302 367 564" fill="none" stroke="#c4b898" stroke-width="17"/>
      <path d="M360 493 438 525 415 663 334 640Z" fill="#b1ad95"/>
      ${lines('M415 484 398 527', '#685e52', 5)}`;
  }
  return `<ellipse cx="305" cy="764" rx="142" ry="16" fill="#596865" opacity=".12"/>
    <path d="M222 578 206 760H280L300 640 326 760H399L376 578Z" fill="${girl ? '#7d8586' : '#65717a'}"/>
    <path d="M245 302Q292 278 354 300L399 330Q437 342 455 484L413 516 392 450 399 619Q300 648 197 617L204 446 183 525 144 504Q156 351 196 331Z" fill="${coat}"/>
    <path d="M270 285 269 329Q300 358 331 326L328 281" fill="#cba589"/>
    ${lines('M273 341 296 373 329 341M297 375V605M223 444 218 596M375 439 382 595', girl ? '#b9aa7b' : '#66796f', 2)}
    <path d="M198 340 218 320 256 309 222 418" fill="#fff4d2" opacity=".2"/>
    <g transform="rotate(${faceAngle} 298 245)">${hair}
      <path d="M230 192Q240 144 302 146 363 149 370 209L358 264Q340 307 300 311 260 303 239 270Z" fill="#dab899"/>
      <path d="M226 231Q207 160 251 137 305 105 356 145 387 173 373 241L355 204 340 176Q296 222 247 202L241 238Z" fill="${father ? '#5c5e53' : '#464c4e'}"/>
      ${father ? lines('M246 166 268 144M335 157 354 179M252 259 270 263M327 263 342 258', '#9a9b83', 3) : ''}
      ${lines(girl && !smile ? 'M258 251 278 254M320 255 339 251' : 'M257 244Q266 241 276 246M320 246Q330 241 340 245', '#626059', 3)}
      ${lines('M299 249 295 269 301 271', '#b48f78', 2)}
      ${lines(smile ? 'M284 281Q301 292 318 279' : 'M288 283Q300 285 309 282', '#967e6e', 2.5)}
    </g>${detail}`;
}

function walkTogether(): string {
  let trees = '';
  for (let i = 0; i < 5; i += 1) {
    trees += tree(110 + i * 76, 593 - i * 58, 1.8 - i * .27, i % 2 ? '#91a889' : '#718f80');
    trees += tree(890 - i * 73, 587 - i * 57, 1.9 - i * .29, '#829c82');
  }
  return `<path d="M0 0H960V720H0Z" fill="#e7e9d6"/>
    <path d="M329 261H635V411H329Z" fill="#d0d8c2"/>${lines('M358 292H607M358 326H607M398 281V360M462 281V360M526 281V360M590 281V360', '#a6b8ab', 12)}
    <path d="M415 385H553L794 720H134Z" fill="#e5d8b9"/>
    <path d="M0 422 420 385 150 720H0M553 385 960 419V720H794Z" fill="#b7c4a5"/>
    ${trees}${lines('M420 404 216 720M554 404 733 720', '#bdc3a7', 3)}
    <path d="M89 614 383 539 719 603 840 660 584 641 338 606 0 720Z" fill="#9caf95" opacity=".45"/>
    <path d="M286 642 447 555 494 558 367 680M509 685 546 553 576 556 579 702" fill="#728477" opacity=".17"/>
    ${backPerson(438, 374, 1.46, '#819ba1')}${backPerson(550, 401, 1.28, yellow, true)}
    <path d="M414 423 467 500" fill="none" stroke="#b4ab8e" stroke-width="8"/><path d="M455 477 484 488 477 539 448 530Z" fill="#b4ab8e"/>
    <path d="M0 0H960V72Q843 127 764 47 651 123 578 52 433 161 347 54 180 127 0 96Z" fill="#698875"/>
    ${lines('M34 720 170 597M848 720 918 606', '#c9c9a8', 3)}`;
}

function bestDrawing(): string {
  let steps = '';
  for (let i = 0; i < 7; i += 1) {
    steps += `<path d="M${244 - i * 18} ${557 + i * 31}H${1253 + i * 20}l20 31H${226 - i * 18}Z" fill="${i % 2 ? '#dfdcc5' : '#ece6d1'}" opacity=".7"/>${lines(`M${244 - i * 18} ${557 + i * 31}Q737 ${561 + i * 31} ${1253 + i * 20} ${557 + i * 31}`, '#9faaa0', 1.5)}`;
  }
  return `<path d="M0 0H1600V900H0Z" fill="${paper}"/>
    <path d="M81 87Q804 43 1521 88L1496 824Q768 853 90 823Z" fill="#ecebd8"/>
    <path d="M188 214Q600 131 1419 183L1394 493 202 522Z" fill="#e6ead7" opacity=".8"/>
    <circle cx="1071" cy="266" r="91" fill="#f5e5b1" opacity=".6"/>
    ${tree(237, 508, 1.3, '#b2c0a5')}${tree(1371, 515, 1.1, '#b2c0a5')}
    <path d="M807 265H1270V288H807ZM822 287H846V492H822ZM1226 287H1250V491H1226Z" fill="#b5c1ad"/>
    ${lines('M806 264 1271 265M818 292 817 497M1254 291 1252 490M851 431H1209', '#8e9e95', 2)}
    <g data-motif="father-watching">${backPerson(1080, 367, .65, '#8d9985')}
      <path d="M1043 433h18l3 34h-22ZM1105 436h19l4 34h-24Z" fill="#bead89"/>
      ${lines('M1046 434V425Q1052 416 1058 427V434M1108 436V427Q1114 418 1122 429V436', '#959a80', 2)}</g>
    ${steps}
    <path d="M363 809 646 579 704 588 505 817M678 808 806 578 847 585 806 818" fill="#bac5ac" opacity=".35"/>
    <g data-motif="complete-companionship">${backPerson(684, 398, 1.35, '#93adb0')}${backPerson(815, 423, 1.2, yellow, true)}</g>
    ${lines('M645 445 670 510M806 492 795 556M215 209 230 207M220 201 246 198M1391 361 1408 347M1400 365 1416 351', '#899b93', 1.5)}
    <path d="M1391 776q8-11 17 0l-3 10-14-2Z" fill="#cf8656" data-motif="orange-dot"/>
    ${lines('M75 82 69 820M95 843 1488 839', '#cec5b1', 1)}`;
}

function classroom(sketch: boolean): string {
  let grain = '';
  for (let i = 0; i < 7; i += 1) grain += lines(`M${131 + i * 147} 610  ${169 + i * 141} 900`, '#b18668', 2);
  const book = sketch ? `<g transform="rotate(-8 765 627)" data-motif="unfinished-empty-steps">
      <path d="M393 492 1128 503 1156 813 405 803Z" fill="#4e5b56" opacity=".18"/>
      <path d="M371 471Q565 451 756 481 938 459 1130 488L1134 786Q943 755 758 784 570 757 382 786Z" fill="#f7efdc"/>
      ${lines('M756 485 758 779', '#d8cdb6', 3)}
      <g fill="none" stroke="#8e9185" stroke-width="2" opacity=".8">
        <path d="M414 650 473 615H676M411 671 478 634H698M419 692 486 655H702M425 714 494 675H707M438 735 504 697H686"/>
        <path d="M473 610V541H634V606M485 610V554H623M480 538H646M438 629V575L465 559M446 636V593L465 580"/>
        <path d="M527 541 532 513 561 511M612 541V526H645M672 615 703 618M492 673 695 677" opacity=".5"/>
      </g>
      <g stroke="#a49d8b" stroke-width="1" opacity=".3"><path d="M606 726 658 737M612 724 667 735M620 726 674 739M618 737 668 741M628 719 657 729"/></g>
      <path d="M1020 736 1106 747 1109 765 1021 754Z" fill="#eee4cf"/>
    </g>
    <g transform="rotate(24 1211 692)"><path d="M1203 552H1217V805L1210 831 1203 805Z" fill="#cfab74"/><path d="M1217 552V805H1211V552" fill="#8f8b74"/><path d="M1208 821 1210 831 1213 821Z" fill="#58615e"/></g>
    <g transform="rotate(-10 1170 510)"><rect x="1140" y="496" width="67" height="30" rx="5" fill="#eee1cb"/><path d="M1180 496h27v30h-27Z" fill="#b6bca6"/></g>` : '';
  return `<path d="M0 0H1600V900H0Z" fill="#d6c9b1"/>
    <path d="M0 0H454V514H0Z" fill="#b8c0b0"/><path d="M29 28H415V425H29Z" fill="#efc991"/>
    <path d="M222 28V425M29 219H415" stroke="#f1e3c8" stroke-width="19"/>
    <path d="M33 423 906 816 1542 713 415 425Z" fill="#ffe5af" opacity=".43"/>
    <path d="M1197 0H1600V480H1197Z" fill="#c5bca7"/>
    ${lines('M1233 243H1518M1250 274H1556M1259 309H1530', '#b1ac99', 5)}
    <path d="M0 555 1600 498V900H0Z" fill="#b6ad96"/>
    <g fill="#8b8f80"><path d="M1070 420h284l26 23h-311Z"/><path d="M1080 445h12v156h-12ZM1341 442h12v118h-12Z"/></g>
    <g data-motif="empty-last-seat"><path d="M545 335Q722 297 925 327L935 438Q737 456 548 435Z" fill="#a48b6d"/>
      ${lines('M566 339V563M909 338V563', '#636e64', 13)}
      <path d="M510 525 937 519 981 571 487 584Z" fill="#9e8a6c"/>
      ${lines('M513 577 490 807M955 565 985 779', '#677064', 13)}
    </g>
    <path d="M180 575 1340 548 1560 900H61Z" fill="#ad8567"/>
    <path d="M177 556 1341 531 1535 872 83 889Z" fill="#c6a27b"/>${grain}
    <path d="M177 556 425 551 1184 881 881 884Z" fill="#ffe4ae" opacity=".42"/>
    ${lines('M217 554 924 883M390 550 1150 877', '#8c826c', 7)}
    ${book}`;
}

function receipt(): string {
  return `<path d="M0 0H600V800H0Z" fill="#d7ddcf"/>
    <path d="M52 514 271 478 309 690 87 729Z" fill="#adbcb1"/>
    <path d="M65 527 256 496 265 551 75 582Z" fill="#e4eadb"/>
    ${lines('M83 622 253 594M89 639 225 616', '#e4eadb', 4)}
    <g transform="rotate(5 315 366)"><path d="M169 74 489 71 505 714 158 721Z" fill="#67756b" opacity=".16"/>
      <path d="M151 58 471 58 481 680 464 674 450 686 435 677 419 687 402 678 387 691 370 680 353 690 335 681 317 693 299 683 281 694 263 684 246 697 228 686 209 697 192 688 174 698 155 688Z" fill="#faf5e7"/>
      <path d="M151 58H471L468 90Q312 77 153 92Z" fill="#eee6d5"/>
      <g fill="#555e57" font-family="monospace, sans-serif" text-anchor="middle">
        <text x="315" y="144" font-size="25" letter-spacing="4">便民药房</text>
        <text x="315" y="178" font-size="14">购药凭条 · 虚构场景</text>
        <text x="315" y="266" font-size="53" letter-spacing="5">07:52</text>
        <text x="315" y="308" font-size="17">打印时间 / 当日早晨</text>
      </g>
      ${lines('M182 201H444M184 335H444M187 438H447M188 539H448', '#969d8d', 1)}
      <g fill="#60685e" font-family="sans-serif" font-size="21"><text x="191" y="381">跌打消肿药贴</text><text x="191" y="416" font-size="17">外用贴剂</text><text x="399" y="412" font-size="18">× 1</text><text x="192" y="480" font-size="16">请保留此凭条</text><text x="192" y="512" font-size="16">用药请遵循药师指导</text></g>
      <path d="M213 579v49m7-49v49m11-49v49m7-49v49m15-49v49m6-49v49m12-49v49m8-49v49m14-49v49m10-49v49m6-49v49m15-49v49m7-49v49m11-49v49m10-49v49m6-49v49" stroke="#747b6b" stroke-width="3"/>
    </g>`;
}

function lateForm(): string {
  return `<path d="M0 0H800V600H0Z" fill="#b9c8bd"/>
    <path d="M59 92 741 77 762 540 75 553Z" fill="#758e83" opacity=".25"/>
    <g transform="rotate(-2 400 300)"><path d="M51 64H734V526H51Z" fill="#f5efdf"/>
      <text x="392" y="121" text-anchor="middle" font-size="30" font-family="serif" fill="#5f6e64" letter-spacing="8">迟到登记表</text>
      <text x="83" y="161" font-size="15" font-family="sans-serif" fill="#8c9483">报到日 · 请如实填写</text>
      <path d="M83 181H702V448H83ZM83 229H702M83 324H702M83 386H702M189 181V448M292 181V448" fill="none" stroke="#9ca894" stroke-width="1.5"/>
      <g font-family="serif" fill="#7a8879" font-size="19"><text x="113" y="212">姓名</text><text x="219" y="212">班级</text><text x="459" y="212">迟到原因</text></g>
      <g font-family="cursive, serif" fill="#54636b" font-size="26"><text x="107" y="280" transform="rotate(-4 107 280)">林夏</text><text x="317" y="274">脚崴了</text><text x="448" y="299" transform="rotate(-3 448 299)">路上耽搁了</text></g>
      <path d="M311 258 411 276M314 278 413 260" fill="none" stroke="#56636a" stroke-width="3.5" stroke-linecap="round" data-motif="crossed-out-reason"/>
      ${lines('M395 296Q420 310 439 297', '#6a7271', 1.5)}
      ${lines('M594 474 690 474M83 491 279 491', '#c1c5af', 1)}
    </g>
    <g transform="rotate(28 722 399)"><rect x="715" y="253" width="13" height="234" rx="5" fill="#4e6875"/><path d="M715 454h13v33l-7 22-6-22Z" fill="#c2c9bb"/><path d="M719 501 721 510 724 501" fill="#4e6875"/>${lines('M724 262 739 270V320', '#d5d5be', 3)}</g>`;
}

function dorm(): string {
  return `<path d="M0 0H1600V900H0Z" fill="#e5e4cf"/>
    <path d="M0 576 1600 549V900H0Z" fill="#c8c7b0"/>
    <path d="M773 101H1187V471H773Z" fill="#9bad9e"/><path d="M790 117H1170V452H790Z" fill="#f2edcc"/>
    ${lines('M982 119V449M791 287H1170', '#c4cdb5', 13)}${tree(1094, 449, .58, '#b4c3a0')}
    <path d="M780 450 387 899H1091L1181 450Z" fill="#fff1c6" opacity=".48"/>
    <path d="M53 161H615V205H53ZM53 487H615V523H53Z" fill="#929f96"/>
    ${lines('M69 124V790M606 123V780M536 189V744M586 189V744M537 277H585M537 365H585M537 453H585M537 547H585M537 635H585', '#8b9b92', 13)}
    <path d="M80 202H525V485H80Z" fill="#94adae"/><path d="M80 202H197L160 485H80ZM416 202H525V485H471Z" fill="#789496"/>
    ${lines('M108 219 102 466M140 219 127 466M470 219 490 466', '#b8c5b8', 3)}
    <path d="M79 525H505V737H79Z" fill="#c4d0c1"/><path d="M81 671Q283 650 503 687V737H81Z" fill="#879f9a"/>
    <path d="M745 558 1294 557 1371 637 714 651Z" fill="#b7a586"/>
    ${lines('M749 648V813M1309 643V800', '#839084', 15)}
    <path d="M849 559 970 548 1040 596 914 612 805 588Z" fill="#f5edda"/>${lines('M914 563V606M826 581 895 594M937 584 992 577', '#b6b99f', 2)}
    <path d="M1093 523h45v64h-45Z" fill="#dae0c9"/>${lines('M1138 536Q1171 527 1167 555 1166 574 1138 568', '#dae0c9', 8)}
    <path d="M955 675h190v79H955Z" fill="#9b9b80"/>${lines('M970 748V865M1131 748V855', '#77867a', 11)}
    <path d="M1144 713 1224 730 1214 839 1137 824Z" fill="#b8aa87"/>${lines('M1159 720Q1160 672 1203 724', '#879780', 8)}
    ${plant(1266, 559, .8)}`;
}

function office(): string {
  let blinds = '';
  for (let i = 0; i < 10; i += 1) {
    blinds += `<path d="M850 ${92 + i * 38}H1419v13H850Z" fill="#a5b19b"/>
      <path d="M${850 - i * 38} 530  ${1230 - i * 47} 900H${1271 - i * 47}L${877 - i * 38} 530Z" fill="#f8dfac" opacity=".38"/>`;
  }
  return `<path d="M0 0H1600V900H0Z" fill="#d8dcc7"/>
    <path d="M0 536H1600V900H0Z" fill="#bfc5ad"/>
    <path d="M832 75H1439V509H832Z" fill="#93a893"/><path d="M850 91H1420V486H850Z" fill="#f1d6a1"/>${blinds}
    <path d="M122 128H541V537H122Z" fill="#a5b39f"/>${lines('M135 258H528M135 384H528M336 143V524', '#d4d8bd', 8)}
    <g fill="#dad6b8"><path d="M161 175h31v74h-31ZM201 184h27v65h-27ZM365 297h35v77h-35ZM406 282h28v92h-28Z"/></g>
    <path d="M718 407Q817 378 919 408V563H718Z" fill="#829689"/>
    ${lines('M743 538V620M897 538V620', '#5f766a', 12)}
    <path d="M442 557 1108 541 1309 678 326 703Z" fill="#b6a685"/>
    <path d="M364 700 1267 679 1223 881H407Z" fill="#a09878"/>
    <path d="M546 582 708 570 759 615 586 632Z" fill="#7f978c"/><path d="M556 580 705 571 721 585 571 599Z" fill="#f4e9cf"/>
    <g fill="#e9e7cf"><path d="M837 547h43v55h-43ZM997 591h43v52h-43Z"/></g>
    ${lines('M881 558Q907 550 902 577 899 591 881 588M1040 600Q1066 592 1063 617 1062 631 1041 630', '#e9e7cf', 6)}
    <path d="M105 679Q218 636 343 669L364 801H128Z" fill="#8d9e87"/>
    ${lines('M143 801 125 900M343 795 360 900', '#637d6c', 13)}
    ${plant(1332, 589, 1.25)}`;
}

function stairwell(sunset: boolean): string {
  let steps = '';
  for (let i = 0; i < 9; i += 1) {
    const y = 441 + i * 40;
    steps += `<path d="M${726 - i * 61} ${y}H${1107 - i * 30}v40H${665 - i * 61}Z" fill="${i % 2 ? '#a8b4a6' : '#ccd0b9'}"/>${lines(`M${726 - i * 61} ${y}H${1107 - i * 30}`, '#839a8e', 2)}`;
  }
  return `<path d="M0 0H1600V900H0Z" fill="${sunset ? '#d8bd96' : '#d8dfd3'}"/>
    <path d="M0 0 489 0 640 442 0 803Z" fill="${sunset ? '#bba481' : '#b9c8bd'}"/>
    <path d="M480 0H1600V437H633Z" fill="${sunset ? '#e6c69b' : '#e3e7d9'}"/>
    <path d="M832 56H1397V353H832Z" fill="${sunset ? '#a89471' : '#94ad9f'}"/>
    <path d="M849 71H1380V338H849Z" fill="${sunset ? '#f3ca90' : '#edf0d8'}"/>
    ${sunset ? '<circle cx="1224" cy="236" r="68" fill="#ffe7ae"/><path d="M848 308Q966 224 1090 305T1380 277V339H848Z" fill="#b7b28a"/>' : '<path d="M850 315Q1000 247 1167 311T1380 288V338H850Z" fill="#bbcdb6"/>'}
    ${lines('M1109 71V338M849 209H1380', sunset ? '#beaa86' : '#bbc9b8', 12)}
    <path d="M640 437H1600V900H0V803Z" fill="${sunset ? '#c2ad89' : '#b3c2b3'}"/>
    ${sunset ? '<path d="M848 338 355 865 1097 900 1380 338Z" fill="#f8dcaa" opacity=".68"/>' : '<path d="M849 338 1212 681 1512 621 1380 338Z" fill="#edf1d7" opacity=".55"/>'}
    ${sunset ? `<path d="M83 602 614 520 641 545 109 644Z" fill="#a09879"/>${lines('M112 643V772M591 550V664M976 436 1441 900M1177 437 1588 736', '#8b9479', 9)}
      <path d="M609 710H1566M589 810H1600M901 447 638 900M1245 444 1359 900" stroke="#b5a88a" stroke-width="2" fill="none"/>` : steps}
    ${lines(sunset ? 'M622 525V398H1519V690M789 399V543M965 399V548M1141 399V558M1318 399V576M621 447H1519' : 'M138 701 730 372 1142 374M138 746 730 418 1142 419M162 688V817M377 569V716M588 451V578M750 373V436M1139 375V489', '#68867d', 8)}
    ${sunset ? '<path d="M795 546 629 844M969 548 1007 900M1145 558 1401 900M1323 576 1596 816" fill="none" stroke="#8d9678" stroke-width="8" opacity=".6"/>' : plant(1295, 365, .66)}
    <path d="M0 865 205 827 341 900H0Z" fill="${sunset ? '#a2997d' : '#92aa9c'}"/>
  `;
}

function trophy(gold: boolean): string {
  const body = gold ? '#c9ac63' : '#aab8bc';
  const edge = gold ? '#a3894f' : '#7d929d';
  return `<ellipse cx="64" cy="114" rx="33" ry="5" fill="#64716e" opacity=".12"/>
    <path d="M39 29H22V40Q22 60 47 62M89 29H106V40Q106 60 81 62" fill="none" stroke="${edge}" stroke-width="6"/>
    <path d="M36 23H92L86 57Q82 73 68 76V93H82V102H46V93H60V76Q46 73 42 57Z" fill="${body}"/>
    <path d="M38 24H49L52 54Q53 65 62 70 46 66 43 53Z" fill="${gold ? '#f3df9b' : '#e1e8e4'}"/>
    <path d="M82 26H90L84 57Q80 69 68 73V67Q81 57 82 26Z" fill="${edge}" opacity=".45"/>
    ${lines('M37 24H91', gold ? '#f7e5b0' : '#e7efeb', 3)}
    <path d="M44 102H84L89 113H39Z" fill="${gold ? '#788377' : '#748791'}"/>
    <path d="M64 60V40M64 51Q54 50 55 43 65 44 64 51M64 57Q74 55 73 48 64 48 64 57" fill="none" stroke="${gold ? '#f5e7b6' : '#e9eeeb'}" stroke-width="1.8" stroke-linecap="round"/>`;
}

function illustration(assetId: AssetId): string {
  switch (assetId) {
    case 'portrait_linxia_casual': case 'portrait_linxia_smile': case 'portrait_father':
    case 'portrait_xiaochen': case 'portrait_ayuan': case 'portrait_teacher':
    case 'portrait_volunteer': case 'portrait_protagonist': return portrait(assetId);
    case 'cg_s6_gate_panorama': case 'cg_s11_post_crop': return gateScene();
    case 'cg_s13_walk_together': return walkTogether();
    case 'cg_ending_best_drawing': return bestDrawing();
    case 'cg_ending_middle_sketch': return classroom(true);
    case 'cg_ending_bystander_seat': return classroom(false);
    case 'prop_pharmacy_receipt': return receipt();
    case 'prop_late_form': return lateForm();
    case 'bg_dorm_morning': return dorm();
    case 'bg_office_afternoon': return office();
    case 'bg_stairwell_echo': return stairwell(false);
    case 'bg_platform_sunset': return stairwell(true);
    case 'trophy_gold': return trophy(true);
    case 'trophy_silver': return trophy(false);
  }
}

function fallbackSource(assetId: AssetId): string {
  const cached = cache.get(assetId);
  if (cached) return cached;
  const { width, height, alt } = ASSET_MANIFEST[assetId];
  const viewBox = assetId === 'cg_s11_post_crop'
    ? `${PHOTO_CROP.x} ${PHOTO_CROP.y} ${PHOTO_CROP.width} ${PHOTO_CROP.height}`
    : assetId === 'cg_s6_gate_panorama' ? '0 0 1600 900'
      : assetId === 'cg_s13_walk_together' ? '0 0 960 720' : `0 0 ${width} ${height}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" fill="none"><title>${xml(alt)}</title>${illustration(assetId)}</svg>`;
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(assetId, source);
  return source;
}

/** 同步返回已登记 PNG 的相对 URL，或自包含 SVG data URL；不会 fetch/HEAD/预探测。 */
export function assetSource(assetId: AssetId): string {
  // JSON 即使被误编辑也不能引入远程地址、未知路径或用户可执行内容。
  const external = READY_EXTERNAL_ASSETS[assetId];
  return external === ASSET_MANIFEST[assetId].path ? external : fallbackSource(assetId);
}

/** 追加一张带无障碍描述、固有比例和一次性回退的图片；不清空容器已有内容。 */
export function renderAssetImage(assetId: AssetId, container: HTMLElement): HTMLImageElement {
  const image = container.ownerDocument.createElement('img');
  const { width, height, alt } = ASSET_MANIFEST[assetId];
  image.alt = alt;
  image.width = width;
  image.height = height;
  image.decoding = 'async';
  image.dataset.assetId = assetId;
  image.style.maxWidth = '100%';
  image.style.height = 'auto';
  const source = assetSource(assetId);
  if (source === ASSET_MANIFEST[assetId].path) {
    let failed = false;
    image.onerror = () => {
      if (failed) return;
      failed = true;
      image.onerror = null;
      image.src = fallbackSource(assetId);
    };
  }
  image.src = source;
  container.append(image);
  return image;
}
