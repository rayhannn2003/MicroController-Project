/* Optional instruction/timer simulation against the actual Stage 6 AVR ELF. */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <simavr/sim_avr.h>
#include <simavr/sim_elf.h>
#include <simavr/sim_io.h>
#include <simavr/avr_ioport.h>
#include <simavr/avr_timer.h>
#include <simavr/sim_cycle_timers.h>

static avr_t *cpu;
static avr_irq_t *echo, *dht;
static unsigned triggers, width_us, previous_trigger, previous_ddr;
static unsigned latest_cm, distance_addr, sweep, readings, worst_error;
static unsigned dht_reads, dht_phase, bit_index, dht_disabled;
static uint8_t dht_data[5];
static uint64_t last_poll, max_poll_gap;

static uint32_t symbol(elf_firmware_t *f, const char *name)
{
    for (unsigned i=0; i<f->symbolcount; i++)
        if (!strcmp(f->symbol[i]->symbol,name)) return f->symbol[i]->addr;
    fprintf(stderr,"Missing symbol: %s\n",name); exit(1);
}
static unsigned read16(unsigned address)
{
    return cpu->data[address] | (cpu->data[address+1]<<8);
}
static avr_cycle_count_t echo_low(avr_t *avr, avr_cycle_count_t when, void *unused)
{
    (void)avr; (void)when; (void)unused;
    avr_raise_irq(echo,0); return 0;
}
static avr_cycle_count_t echo_high(avr_t *avr, avr_cycle_count_t when, void *unused)
{
    (void)when; (void)unused;
    avr_raise_irq(echo,1);
    avr_cycle_timer_register_usec(avr,width_us,echo_low,NULL);
    return 0;
}
static void trigger_changed(avr_irq_t *irq, uint32_t value, void *unused)
{
    (void)irq; (void)unused;
    value &= 1;
    if (previous_trigger && !value) {
        if (triggers) {
            unsigned cm=read16(distance_addr);
            if (latest_cm==0 || latest_cm==999) assert(cm==65535);
            else {
                unsigned error=abs((int)cm-(int)latest_cm);
                if(error>worst_error) worst_error=error;
                assert(error<=1);
            }
            readings++;
        }
        triggers++;
        if (sweep) {
            static const unsigned distances[]={2,18,29,30,31,60,400,0,999};
            latest_cm=distances[(triggers-1) % 9];
        } else {
            /* First object stays present after the timed sample resumes;
             * a clear interval then permits a second sampling cycle. */
            latest_cm=cpu->cycle<1400000 ? 60 : cpu->cycle<10000000 ? 18 :
                      cpu->cycle<11000000 ? 0 : 18;
        }
        width_us=latest_cm==999 ? 35000 : latest_cm*58;
        if (width_us) avr_cycle_timer_register_usec(cpu,200,echo_high,NULL);
    }
    previous_trigger=value;
}

/* DHT response: 80 us low, 80 us high, then 40 bits, 50 us low each. */
static avr_cycle_count_t dht_edge(avr_t *avr, avr_cycle_count_t when, void *unused)
{
    (void)avr; (void)unused;
    switch(dht_phase) {
    case 0: avr_raise_irq(dht,0); dht_phase=1; return when+80;
    case 1: avr_raise_irq(dht,1); dht_phase=2; return when+80;
    case 2: avr_raise_irq(dht,0); dht_phase=3; return when+50;
    case 3:
        avr_raise_irq(dht,1); dht_phase=4;
        return when+((dht_data[bit_index/8] & (0x80>>(bit_index%8))) ? 70 : 26);
    case 4:
        avr_raise_irq(dht,0);
        dht_phase=++bit_index==40 ? 5 : 3;
        return when+50;
    default: avr_raise_irq(dht,1); return 0;
    }
}
static void direction_changed(avr_irq_t *irq, uint32_t value, void *unused)
{
    (void)irq; (void)unused;
    if ((previous_ddr & 8) && !(value & 8) && !dht_disabled) {
        dht_reads++;
        dht_data[0]=66; dht_data[1]=0; dht_data[2]=30; dht_data[3]=0;
        dht_data[4]=dht_reads==1 ? 96 : 97; /* Second read has bad checksum. */
        bit_index=dht_phase=0;
        avr_cycle_timer_register_usec(cpu,20,dht_edge,NULL);
    }
    previous_ddr=value;
}

int main(int argc, char **argv)
{
    assert(argc>=2 && argc<=4);
    sweep=argc>2;
    dht_disabled=argc>3;
    elf_firmware_t firmware={0};
    assert(elf_read_firmware(argv[1],&firmware)==0);
    cpu=avr_make_mcu_by_name("atmega32");
    assert(cpu && avr_init(cpu)==0);
    /* simavr 1.6 shares an ATmega8 model missing Timer0 CTC. Add the
     * ATmega32's documented WGM bits to the simulation model, not firmware. */
    for(avr_io_t *io=cpu->io_port; io; io=io->next) {
        if(strcmp(io->kind,"timer")) continue;
        avr_timer_t *timer=(avr_timer_t *)io;
        if(timer->name=='0' && timer->wgm_op[2].kind==avr_timer_wgm_none) {
            timer->wgm[0]=(avr_regbit_t){.reg=0x53,.bit=6,.mask=1};
            timer->wgm[1]=(avr_regbit_t){.reg=0x53,.bit=3,.mask=1};
            timer->wgm_op[2]=(avr_timer_wgm_t)AVR_TIMER_WGM_CTC();
        }
    }
    cpu->frequency=1000000;
    avr_load_firmware(cpu,&firmware);
    echo=avr_io_getirq(cpu,AVR_IOCTL_IOPORT_GETIRQ('A'),4);
    dht=avr_io_getirq(cpu,AVR_IOCTL_IOPORT_GETIRQ('A'),3);
    avr_irq_register_notify(avr_io_getirq(cpu,AVR_IOCTL_IOPORT_GETIRQ('A'),0),trigger_changed,NULL);
    avr_irq_register_notify(avr_io_getirq(cpu,AVR_IOCTL_IOPORT_GETIRQ('A'),IOPORT_IRQ_DIRECTION_ALL),direction_changed,NULL);
    avr_ioport_external_t external={.name='A',.mask=0x1e,.value=0x0e};
    avr_ioctl(cpu,AVR_IOCTL_IOPORT_SET_EXTERNAL('A'),&external);
    avr_raise_irq(echo,0);
    uint32_t poll_pc=symbol(&firmware,"timer_ticks");
    distance_addr=symbol(&firmware,"distance") & 0xffff;
    uint32_t temp_addr=symbol(&firmware,"temperature") & 0xffff;
    uint32_t humid_addr=symbol(&firmware,"humidity") & 0xffff;
    uint32_t dht_status_addr=symbol(&firmware,"dht_status") & 0xffff;
    uint32_t ms_addr=symbol(&firmware,"system_millis") & 0xffff;
    uint32_t phase_addr=symbol(&firmware,"cycle_phase") & 0xffff;
    unsigned drove_before=0, drove_after=0, saw_valid_dht=0, saw_bad_dht=0;
    unsigned saw_result=0, cycle_stops=0, cycle_resumes=0, previous_phase=0;
    uint32_t old_ms=0;
    while(cpu->cycle<20000000) {
        assert(avr_run(cpu)!=cpu_Crashed);
        if(cpu->data[0x45]==2 && cpu->pc==poll_pc) {
            if(last_poll && cpu->cycle-last_poll>max_poll_gap)
                max_poll_gap=cpu->cycle-last_poll;
            last_poll=cpu->cycle;
        } else if(cpu->data[0x45]!=2) last_poll=0;
        unsigned pwm=cpu->data[0x4a];
        unsigned phase=read16(phase_addr);
        if (phase && cpu->cycle>10000) assert(pwm==0);
        if (phase==1 && previous_phase==0) cycle_stops++;
        if (phase==0 && previous_phase==3) cycle_resumes++;
        if (phase==3) saw_result=1;
        previous_phase=phase;
        if(!sweep) {
            if(cpu->cycle>1150000 && cpu->cycle<1350000 && pwm==39) drove_before++;
            if(cpu->cycle>1600000 && cpu->cycle<2300000) assert(pwm==0);
            if(cpu->cycle>9000000 && cpu->cycle<9800000 && pwm==39) drove_after++;
        }
        if(cpu->data[dht_status_addr]==1) {
            assert(cpu->data[temp_addr]==30 && cpu->data[humid_addr]==66);
            saw_valid_dht=1;
        }
        if(cpu->data[dht_status_addr]==2) saw_bad_dht=1;
        /* Sampling must leave Timer1 intact and freeze Timer0 with motors off. */
        if(cpu->cycle>10000) {
            assert(cpu->data[0x4f]==0xa2 && cpu->data[0x4e]==0x19);
            assert(cpu->data[0x46]==49);
            if(cpu->data[0x45]!=0) assert(pwm==0 && (cpu->data[0x53]&7)==0);
        }
        old_ms=read16(ms_addr);
    }
    assert(max_poll_gap<100);
    assert(readings>40);
    assert(saw_result);
    if(dht_disabled) assert(saw_bad_dht);
    else assert(saw_valid_dht && dht_reads>=1);
    if(!sweep) {
        assert(drove_before && drove_after && saw_bad_dht && dht_reads>=2);
        assert(cycle_stops==2 && cycle_resumes==2);
    }
    printf("PASS: %u readings, <=%u cm echo error, max polling gap %llu us; logical clock %u ms.\n",
        readings,worst_error,(unsigned long long)max_poll_gap,old_ms);
    avr_terminate(cpu);
}
