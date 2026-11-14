import type { CSSProperties } from 'react';
import { HearthIllustration } from '@/components/today/hearth-illustration';
import { cn } from '@/lib/utils';

const far = 'M0 300V186Q0 186 60 181Q120 177 180 172Q240 167 300 171Q360 174 420 169Q480 165 540 177Q600 190 660 177Q720 164 780 151Q840 138 900 127Q960 115 1020 104Q1080 92 1140 110Q1200 127 1260 130Q1320 133 1380 142Q1440 151 1500 151Q1560 152 1620 146Q1680 140 1740 157Q1800 175 1860 178Q1920 181 1980 192Q2040 203 2100 196Q2160 188 2220 168Q2280 147 2340 143Q2400 138 2460 126Q2520 114 2580 125Q2640 136 2700 135Q2760 135 2820 127Q2880 119 2940 122Q3000 125 3060 120Q3120 114 3180 136Q3240 159 3300 171Q3360 183 3420 188Q3480 193 3540 194Q3600 195 3660 175Q3720 156 3780 159Q3840 162 3900 158Q3960 153 4020 153Q4080 154 4140 152Q4200 149 4260 128Q4320 106 4380 107Q4440 108 4500 106Q4560 103 4620 120Q4680 136 4740 153Q4800 171 4860 168Q4920 165 4980 171Q5040 178 5100 168Q5160 158 5220 167Q5280 175 5340 183Q5400 190 5460 182Q5520 174 5580 171Q5640 168 5700 142Q5760 116 5820 112Q5880 109 5940 111T6000 114V300Z';
const near = 'M0 300V248Q0 248 75 245Q150 241 225 238Q300 235 375 219Q450 204 525 202Q600 201 675 200Q750 198 825 204Q900 210 975 211Q1050 213 1125 208Q1200 203 1275 207Q1350 211 1425 213Q1500 216 1575 231Q1650 246 1725 247Q1800 249 1875 249Q1950 249 2025 242Q2100 234 2175 229Q2250 224 2325 228Q2400 232 2475 228Q2550 223 2625 223Q2700 222 2775 209Q2850 195 2925 193Q3000 192 3075 194Q3150 195 3225 204Q3300 212 3375 221Q3450 229 3525 226Q3600 222 3675 226Q3750 230 3825 228Q3900 226 3975 238Q4050 249 4125 250Q4200 251 4275 248Q4350 245 4425 236Q4500 227 4575 216Q4650 206 4725 209Q4800 212 4875 209Q4950 207 5025 211Q5100 215 5175 207Q5250 198 5325 197Q5400 197 5475 201Q5550 205 5625 214Q5700 222 5775 235Q5850 247 5925 243T6000 240V300Z';
const trees = 'M187 243L199 215L211 243ZM211 242L218 225L225 242ZM214 242L228 209L242 242ZM227 242L238 215L249 242ZM249 241L256 224L263 241ZM264 240L273 218L282 240ZM274 240L282 222L290 240ZM285 239L297 210L309 239ZM297 238L307 215L317 238ZM303 235L317 202L331 235ZM325 232L332 215L339 232ZM340 228L354 194L368 228ZM354 226L364 203L374 226ZM1003 216L1010 199L1017 216ZM1014 216L1028 182L1042 216ZM1036 217L1043 200L1050 217ZM1048 217L1055 200L1062 217ZM1064 215L1072 195L1080 215ZM1073 215L1085 186L1097 215ZM1082 214L1096 181L1110 214ZM1092 213L1106 179L1120 213ZM1105 212L1119 179L1133 212ZM1132 211L1141 190L1150 211ZM1137 210L1151 176L1165 210ZM1160 209L1169 187L1178 209ZM1175 208L1183 189L1191 208ZM1192 207L1200 189L1208 207ZM1211 208L1218 191L1225 208ZM1227 209L1236 187L1245 209ZM1238 210L1252 177L1266 210ZM1256 211L1267 185L1278 211ZM1269 212L1283 178L1297 212ZM1784 253L1794 230L1804 253ZM1806 253L1815 232L1824 253ZM1825 253L1835 230L1845 253ZM1831 253L1845 219L1859 253ZM1845 253L1858 221L1871 253ZM1863 253L1874 227L1885 253ZM1881 253L1894 223L1907 253ZM1899 253L1907 235L1915 253ZM1904 253L1917 221L1930 253ZM1923 253L1932 232L1941 253ZM1942 253L1953 227L1964 253ZM1951 252L1964 221L1977 252ZM1972 250L1979 233L1986 250ZM2537 227L2551 194L2565 227ZM2558 227L2569 201L2580 227ZM2572 227L2583 200L2594 227ZM2588 227L2601 196L2614 227ZM2606 227L2619 197L2632 227ZM2621 227L2629 209L2637 227ZM2629 227L2642 196L2655 227ZM2654 227L2662 209L2670 227ZM2660 227L2671 202L2682 227ZM2676 226L2690 192L2704 226ZM2696 225L2709 195L2722 225ZM2710 222L2722 194L2734 222ZM2730 219L2741 192L2752 219ZM2737 217L2750 187L2763 217ZM2755 215L2764 194L2773 215ZM3269 214L3276 197L3283 214ZM3278 215L3288 190L3298 215ZM3289 216L3299 193L3309 216ZM3302 218L3314 190L3326 218ZM3323 220L3336 189L3349 220ZM3337 221L3346 200L3355 221ZM3350 223L3362 195L3374 223ZM3369 225L3379 201L3389 225ZM3378 226L3390 197L3402 226ZM3398 229L3412 196L3426 229ZM3413 230L3425 201L3437 230ZM3427 232L3439 204L3451 232ZM3443 233L3451 213L3459 233ZM3452 232L3461 211L3470 232ZM3462 232L3472 209L3482 232ZM3998 247L4011 216L4024 247ZM4019 250L4033 216L4047 250ZM4034 252L4044 228L4054 252ZM4050 253L4057 237L4064 253ZM4056 253L4068 224L4080 253ZM4074 254L4085 227L4096 254ZM4089 254L4103 220L4117 254ZM4109 254L4117 234L4125 254ZM4124 254L4137 222L4150 254ZM4148 255L4155 238L4162 255ZM4707 213L4719 185L4731 213ZM4722 213L4734 185L4746 213ZM4731 214L4744 183L4757 214ZM4751 214L4763 186L4775 214ZM4763 215L4772 193L4781 215ZM4773 215L4782 193L4791 215ZM4789 216L4798 195L4807 216ZM4797 216L4808 190L4819 216ZM4819 215L4826 198L4833 215ZM4829 215L4836 199L4843 215ZM4846 214L4854 194L4862 214ZM4863 214L4871 195L4879 214ZM4878 213L4885 197L4892 213ZM4886 213L4895 191L4904 213ZM4901 212L4913 184L4925 212ZM4914 212L4924 188L4934 212ZM4927 211L4938 184L4949 211ZM4946 211L4954 192L4962 211ZM5465 205L5478 174L5491 205ZM5484 206L5494 181L5504 206ZM5496 207L5504 187L5512 207ZM5503 207L5514 181L5525 207ZM5524 208L5534 184L5544 208ZM5541 209L5550 188L5559 209ZM5560 211L5567 195L5574 211ZM5566 213L5579 181L5592 213ZM5585 214L5593 194L5601 214ZM5599 216L5613 183L5627 216ZM5609 217L5622 185L5635 217ZM5627 219L5635 201L5643 219ZM5645 221L5655 197L5665 221ZM5661 223L5672 196L5683 223ZM5672 225L5683 198L5694 225ZM5694 227L5704 204L5714 227Z';

const stars: [side: 'l' | 'r', x: number, y: number, size: number, dur: number, delay: number][] = [
  ['l', 0.18, 14, 2, 9.7, -2],
  ['l', 0.52, 9, 1.5, 13.3, -9],
  ['l', 0.74, 22, 2, 7.9, -5],
  ['l', 0.33, 31, 1.5, 11.9, -1],
  ['l', 0.6, 40, 2.5, 15.1, -7],
  ['l', 0.22, 48, 1.5, 0, 0],
  ['r', 0.2, 30, 2, 12.7, -3],
  ['r', 0.62, 12, 1.5, 8.3, -6],
  ['r', 0.42, 42, 2, 10.9, -4],
  ['r', 0.76, 34, 1.5, 0, 0],
  ['r', 0.3, 52, 2.5, 14.3, -11],
];

const sparks: [side: 'l' | 'r', x: number, y: number, drift: number, dur: number, delay: number][] = [
  ['l', 0.62, 46, 1.2, 8.3, 0],
  ['l', 0.4, 54, -1.6, 10.7, -4.2],
  ['l', 0.78, 60, 0.8, 6.9, -2.6],
  ['r', 0.38, 50, -1, 9.4, -1.4],
  ['r', 0.64, 58, 1.4, 7.6, -5.1],
];

function place(side: 'l' | 'r', x: number, y: number): CSSProperties {
  return { [side === 'l' ? 'left' : 'right']: `calc(var(--scene-band) * ${x})`, top: `${y}%` };
}

/**
 * The shells' decorative background: a low-contrast landscape of hills and a treeline along the bottom, in dark a thin
 * moon and faint stars in the side bands, in light a warm horizon haze and two drifting clouds, plus breathing flame
 * glows behind the top of the page and a few rising sparks. `still` (legal) keeps only a softer, static landscape.
 * `moment` (the moment flow): a still sky and a dimmer, taller landscape with a small campfire at the bottom centre whose
 * glow and halo swell and settle at the paced-breathing tempo (in 4 s, out 6 s) and fade out while a breathing player
 * (`[data-breath='running']`) runs. `app`: the signed-in shell's wider content column and, on phones, the landscape above its bottom tab bar. Calm mode keeps the landscape and sky static
 * and softer and hides the glows, sparks and campfire.
 */
export function AmbientScene({ variant = 'full', app = false }: { variant?: 'full' | 'still' | 'moment'; app?: boolean }) {
  const full = variant === 'full';
  const moment = variant === 'moment';
  return (
    <div aria-hidden="true" className={cn('ember-scene', variant === 'still' && 'ember-scene--still', moment && 'ember-scene--moment', app && 'ember-scene--app')}>
      {(full || moment) && (
        <>
          <div className="ember-sky">
            <svg viewBox="-20 -20 40 40" focusable="false" className="ember-moon" style={place('r', 0.46, 13)}>
              <path d="M-18 0A18 18 0 0 1 0-18A14 14 0 0 0-12 0A14 14 0 0 0 0 18A18 18 0 0 1-18 0Z" />
            </svg>
            {stars.map(([side, x, y, size, dur, delay], i) => (
              <i
                key={i}
                className={cn('ember-star', full && dur > 0 && 'ember-star--twinkle')}
                style={{
                  ...place(side, x, y),
                  width: size,
                  height: size,
                  ...(full && dur > 0 && { animationDuration: `${dur}s`, animationDelay: `${delay}s` }),
                }}
              />
            ))}
          </div>
          <div className="ember-haze" />
          <div className="ember-cloud" />
          <div className="ember-cloud ember-cloud--late" />
        </>
      )}
      <svg viewBox="0 0 6000 300" preserveAspectRatio="xMidYMax slice" focusable="false" className="ember-land">
        <path d={far} className="ember-land-far" />
        <path d={trees} className="ember-land-trees" />
        <path d={near} className="ember-land-near" />
      </svg>
      {moment && (
        <div data-calm-hide className="ember-camp">
          <div className="ember-camp-rest" />
          <div className="ember-camp-swell">
            <div className="ember-camp-glow" />
            <div className="ember-camp-halo" />
          </div>
          <HearthIllustration />
        </div>
      )}
      {full && (
        <div data-calm-hide>
          <div className="ember-glow" />
          <div className="ember-glow ember-glow--side" />
          <div className="ember-glow ember-glow--side ember-glow--right" />
          {sparks.map(([side, x, y, drift, dur, delay], i) => (
            <i
              key={i}
              className="ember-rise"
              style={
                { ...place(side, x, y), '--drift': `${drift}rem`, animationDuration: `${dur}s`, animationDelay: `${delay}s` } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
